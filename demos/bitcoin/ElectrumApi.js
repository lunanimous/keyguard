class ElectrumApi {
    /**
     * @param {string|Uint8Array} script
     * @returns {Promise<{confirmed: number, unconfirmed: number}>}
     */
    static async getBalance(script) {
        return this._socket.request('blockchain.scripthash.get_balance', await pubKeyToHash(script));
    }

    /**
     * @param {string|Uint8Array} script
     * @returns {Promise<{height: number, tx_hash: string}[]>}
     */
    static async getReceipts(script, isScriptHash = false) {
        return this._socket.request('blockchain.scripthash.get_history', isScriptHash ? script : await pubKeyToHash(script));
    }

    /**
     * @param {string|Uint8Array} script
     */
    static async getHistory(script) {
        const history = await this.getReceipts(script);

        // TODO: Skip known receipts

        // Sort by height DESC to fetch newest txs first
        history.sort((a, b) => (b.height || Number.MAX_SAFE_INTEGER) - (a.height || Number.MAX_SAFE_INTEGER));

        /** @type {number[]} */
        const blockHeights = history.reduce((array, entry) => {
            const height = entry.height;
            if (typeof height === 'number' && height > 0) array.push(height);
            return array;
        }, []);

        /** @type {Map<number, any>} */
        const blockHeaders = new Map();

        // Fetch block headers
        for (const height of blockHeights) {
            try {
                blockHeaders.set(height, await this.getBlockHeader(height));
            } catch (error) {
                console.error(error);
                break;
            }
        }

        // Fetch transactions
        const txs = [];
        for (const { tx_hash, height } of history) {
            try {
                const tx = await this.getTransaction(tx_hash);

                const blockHeader = blockHeaders.get(height);
                if (blockHeader) {
                    tx.block_height = height;
                    tx.block_time = blockHeader.timestamp;
                    tx.block_hash = blockHeader.blockHash;
                }

                txs.push(tx);
            } catch (error) {
                console.error(error);
                return txs;
            }
        }

        return txs;
    }

    /**
     * @param {number} height
     */
    static async getBlockHeader(height) {
        /** @type {string} */
        const raw = await this._socket.request('blockchain.block.header', height);

        const block = BitcoinJS.Block.fromHex(raw);

        return {
            blockHash: block.getId(),
            blockHeight: height,
            timestamp: block.timestamp,
            prevHash: bytesToHex(Array.from(block.prevHash).reverse()),
            bits: block.bits,
            nonce: block.nonce,
            version: block.version,
            merkleRoot: bytesToHex(block.merkleRoot),
            weight: block.weight(),
        };
    }

    /**
     * @param {string} hash
     * @param {number} [height]
     */
    static async getTransaction(hash, height) {
        /** @type {string} */
        const raw = await this._socket.request('blockchain.transaction.get', hash);

        let blockHeader;
        if (typeof height === 'number' && height > 0) {
            try {
                blockHeader = await this.getBlockHeader(height);
            } catch (error) {
                console.error(error);
            }
        }

        return this.transactionToPlain(raw, blockHeader);
    }

    /**
     * @param {string|Uint8Array} script
     * @param {(status: {tx_hash: string, height: number}) => any} callback
     */
    static async subscribeStatus(script, callback) {
        this._socket.subscribe(
            'blockchain.scripthash',
            async (scriptHash, status) => {
                callback(await this.getReceipts(scriptHash, true));
            },
            await pubKeyToHash(script),
        );
    }

    /**
     * @param {(blockHeader: any) => any} callback
     */
    static async subscribeHeaders(callback) {
        this._socket.subscribe('blockchain.headers', async (headerInfo) => {
            callback(await this.getBlockHeader(headerInfo.height));
        });
    }

    /**
     * @param {string} rawTx
     * @returns {Promise<PlainTransaction>}
     */
    static async broadcastTransaction(rawTx) {
        const tx = this.transactionToPlain(rawTx);
        const hash = await this._socket.request('blockchain.transaction.broadcast', rawTx);
        if (hash === tx.txid) return tx;
        else throw new Error(hash); // Protocol v1.0 returns an error as a string
    }

    /**
     * @param {string | BitcoinJS.Transaction} tx
     * @param {PlainBlockHeader} plainHeader
     */
    static transactionToPlain(tx, plainHeader) {
        if (typeof tx === 'string') tx = BitcoinJS.Transaction.fromHex(tx);

        const plain = {
            txid: tx.getId(),
            inputs: tx.ins.map((input, index) => this.inputToPlain(input, index)),
            outputs: tx.outs.map((output, index) => this.outputToPlain(output, index)),
            version: tx.version,
            vsize: tx.virtualSize(),
            isCoinbase: tx.isCoinbase(),
            weight: tx.weight(),
            block_hash: null,
            block_height: null,
            block_time: null,
        };

        if (plainHeader) {
            plain.block_hash = plainHeader.blockHash;
            plain.block_height = plainHeader.blockHeight;
            plain.block_time = plainHeader.timestamp;
        }

        return plain;
    }

    /**
     * @param {any} input
     * @param {number} index
     * @returns {{
     *     script: Uint8Array,
     *     txid: string,
     *     addresss: string,
     *     witness: Array<number | Uint8Array>,
     *     index: number,
     *     output_index: number
     * }}
     */
    static inputToPlain(input, index) {
        return {
            script: input.script,
            txid: bytesToHex(Array.from(input.hash).reverse()),
            address: this.deriveAddressFromInput(input),
            witness: input.witness,
            index,
            output_index: input.index,
        };
    }

    /**
     * @param {any} output
     * @param {number} index
     * @returns {{
     *     script: Uint8Array,
     *     addresss: string,
     *     value: number,
     *     index: number,
     * }}
     */
    static outputToPlain(output, index) {
        return {
            script: output.script,
            address: BitcoinJS.address.fromOutputScript(output.script, this.network),
            value: output.value,
            index,
        };
    }

    /**
     * @param {any} input
     * @returns {string}
     */
    static deriveAddressFromInput(input) {
        const chunks = BitcoinJS.script.decompile(input.script);
        const witness = input.witness;

        // Legacy addresses P2PKH (1...)
        // a4453c9e224a0927f2909e49e3a97b31b5aa74a42d99de8cfcdaf293cb2ecbb7 0,1
        if (chunks.length === 2 && witness.length === 0) {
            return BitcoinJS.payments.p2pkh({
                pubkey: chunks[1],
                network: this.network,
            }).address;
        }

        // Nested SegWit P2SH(P2WPKH) (3...)
        // 6f4e12fa9e869c8721f2d747e042ff80f51c6757277df1563b54d4e9c9454ba0 0,1,2
        if (chunks.length === 1	&& witness.length === 2) {
            return BitcoinJS.payments.p2sh({
                redeem: BitcoinJS.payments.p2wpkh({
                    pubkey: witness[1],
                    network: this.network,
                }),
            }).address;
        }

        // Native SegWit P2WPKH (bc1...)
        // 3c89e220db701fed2813e0af033610044bc508d2de50cb4c420b8f3ad2d72c5c 0
        if (chunks.length === 0 && witness.length === 2) {
            return BitcoinJS.payments.p2wpkh({
                pubkey: witness[1],
                network: this.network,
            }).address;
        }

        // Legacy MultiSig P2SH(P2MS) (3...)
        // 80975cddebaa93aa21a6477c0d050685d6820fa1068a2731db0f39b535cbd369 0,1,2
        if (chunks.length > 2 && witness.length === 0) {
            const m = chunks.length - 2; // Number of signatures
            const pubkeys = BitcoinJS.script.decompile(chunks[chunks.length - 1])
                .filter((n) => typeof n !== 'number');

            return BitcoinJS.payments.p2sh({
                redeem: BitcoinJS.payments.p2ms({
                    m,
                    pubkeys,
                    network: this.network,
                }),
            }).address;
        }

        // Nested SegWit MultiSig P2SH(P2WSH(P2MS)) (3...)
        // 80975cddebaa93aa21a6477c0d050685d6820fa1068a2731db0f39b535cbd369 3
        if (chunks.length === 1 && witness.length > 2) {
            const m = witness.length - 2; // Number of signatures
            const pubkeys = BitcoinJS.script.decompile(witness[witness.length - 1])
                .filter((n) => typeof n !== 'number');

            return BitcoinJS.payments.p2sh({
                redeem: BitcoinJS.payments.p2wsh({
                    redeem: BitcoinJS.payments.p2ms({
                        m,
                        pubkeys,
                        network: this.network,
                    }),
                }),
            }).address;
        }

        // Native SegWit MultiSig P2WSH(P2MS) (bc1...)
        // 54a3e33efff4c508fa5c8ce7ccf4b08538a8fd2bf808b97ae51c21cf83df2dd1 0
        if (chunks.length === 0 && witness.length > 2) {
            const m = witness.length - 2; // Number of signatures
            const pubkeys = BitcoinJS.script.decompile(witness[witness.length - 1])
                .filter((n) => typeof n !== 'number');

            return BitcoinJS.payments.p2wsh({
                redeem: BitcoinJS.payments.p2ms({
                    m,
                    pubkeys,
                    network: this.network,
                }),
            }).address;
        }

        console.error(new Error('Cannot decode address from input'));
        return '-unkown-';
    }
}

ElectrumApi._socket = new ElectrumWS(undefined, {
    proxy: true,
    network: 'testnet',
});

/**
 * @typedef {
 *     address: string,
 *     balance: number,
 *     txCount: number,
 *     utxoCount: number,
 * } AddressStats
 *
 * @typedef {
 *     address: string,
 *     value: number,
 *     txid: string,
 *     output_index: number,
 *     script: string,
 * } Input
 *
 * @typedef {
 *     address: string,
 *     value: number,
 *     index: number,
 *     script: string,
 *     spent_txid?: string,
 * } Output
 *
 * @typedef {
 *     txid: string,
 *     block_height?: number,
 *     block_time?: number,
 *     block_hash?: string,
 *     confirmations: number,
 *     version: number,
 *     seen_time: number,
 *     vsize: number,
 *     fee: number,
 *     inputs: Input[],
 *     outputs: Output[],
 * } Transaction
 */

INACTIVE_ADDRESS_GAP = 1; // As soon as one inactive address is found, search stops

ElectrumApi.network = TEST.network;

var app = new Vue({
    el: '#app',
    data: {
        isNimiqLoaded: false,
        mnemonic: TEST.mnemonic,
        ext_index: 0,
        int_index: 0,
        ext_addresses: [],
        int_addresses: [],
        /** @type {{[hash: string]: Transaction}} */
        txs: {},

        txTo: '',
        txAmount: 0,
        txFeePerByte: 1,
        signedTx: '',

        head: {
            height: 0,
            timestamp: 0,
        },
    },
    computed: {
        seed() { // Nimiq.SerialBuffer
            return this.isNimiqLoaded && this.mnemonic
                ? Nimiq.MnemonicUtils.mnemonicToSeed(this.mnemonic)
                : '';
        },
        seedHex() { // String
            return this.seed
                ? Nimiq.BufferUtils.toHex(this.seed)
                : '';
        },
        masterExtPrivKey() { // BitcoinJS BIP32 Object
            return this.seed
                ? BitcoinJS.bip32.fromSeed(NodeBuffer.Buffer.from(this.seed), TEST.network)
                : null;
        },
        accountExtPrivKey() { // BitcoinJS BIP32 Object
            return this.masterExtPrivKey
                ? this.masterExtPrivKey.derivePath(DERIVATION_PATH_ACCOUNT)
                : null;
        },
        accountExtPubKey() { // BitcoinJS BIP32 Object
            return this.accountExtPrivKey
                ? this.accountExtPrivKey.neutered()
                : null;
        },
        xpub() { // String
            return this.accountExtPubKey
                ? this.accountExtPubKey.toBase58()
                : '';
        },
        txsArray() { // Array
            return Object.values(this.txs).sort((tx1, tx2) => {
                return (tx2.block_time || Number.MAX_SAFE_INTEGER) - (tx1.block_time || Number.MAX_SAFE_INTEGER);
            });
        },
        utxos() { // UTXO = Unspent TX Output
            if (!this.txsArray.length) return [];

            // Create a flat array of inputs.
            // Build an array of strings of the form '<tx hash>:<output index>' to be able to do a standard Array.includes() test below
            // /** @type {string[]} */
            const inputs = this.txsArray.reduce((list, tx) => list.concat(tx.inputs.map(input => `${input.txid}:${input.output_index}`)), []);

            // Create a flat array of outputs.
            // Include tx hash and output index into the output, to be able to map it to a usable output later.
            const outputs = this.txsArray.reduce((list, tx) => {
                const txid = tx.txid;
                const outputs = tx.outputs.map((output) => ({ ...output, txid }));
                return list.concat(outputs);
            }, []);

            const externalAddresses = this.ext_addresses.map(addressInfo => addressInfo.address);
            const internalAddresses = this.int_addresses.map(addressInfo => addressInfo.address);

            const utxos = [];

            for (const output of outputs) {
                const address = output.address;
                // Exclude outputs which are not ours
                if (!externalAddresses.includes(address) && !internalAddresses.includes(address)) continue;

                // Exlude outputs which are already spent
                if (inputs.includes(`${output.txid}:${output.index}`)) continue;
                // if (output.spent_txid) continue;

                // Format required by BitcoinJS (for tx inputs)
                // {
                //     hash: '<tx hash as HEX string>',
                //     index: <output index>
                //     witnessUtxo: {
                //         script: <Buffer of the output script>,
                //         value: <output value>,
                //     },
                //     redeemScript: <Buffer of redeem script>, // Added later when creating tx
                // }
                utxos.push({
                    hash: output.txid,
                    index: output.index,
                    witnessUtxo: {
                        script: NodeBuffer.Buffer.from(output.script),
                        value: output.value,
                    },
                    // Extra properties required for tx building to work:
                    address,
                    isInternal: internalAddresses.includes(address),
                });
            }

            return utxos;
        },
        balance() {
            return this.utxos.reduce((sum, utxo) => sum + utxo.witnessUtxo.value, 0);
        },
        nextReceivingAddress() {
            // Return first unused external address
            return this.ext_addresses.find(addressInfo => !addressInfo.active);
        },
        nextChangeAddress() {
            // Return first unused external address
            return this.int_addresses.find(addressInfo => !addressInfo.active);
        },
    },
    watch: {
        async accountExtPubKey(xPub, oldXPub) {
            if (!xPub) return;
            if (oldXPub !== null) {
                this.ext_addresses = [];
                this.int_addresses = [];
                this.txs = {};
            }

            /**
             * EXTERNAL ADDRESSES
             */

            let inactiveAddressGapWidth = 0;

            for (const addressInfo of this.ext_addresses) {
                if (addressInfo.active) {
                    // TODO: Update tx history (with low priority)
                    continue;
                }

                await this.updateAddressInfoActivity(addressInfo);

                if (!addressInfo.active) inactiveAddressGapWidth++;
                if (inactiveAddressGapWidth >= INACTIVE_ADDRESS_GAP) break;
            }

            while (inactiveAddressGapWidth < INACTIVE_ADDRESS_GAP) {
                // Derive next address
                const index = this.ext_addresses.length;
                const node = xPub
                    .derive(0) // 0 for external addresses
                    .derive(index);
                const scriptPubKey = nodeToNestedWitnessScriptPubKey(node);
                const address = scriptPubKeyToAddress(scriptPubKey);

                const addressInfo = {
                    scriptPubKey,
                    address,
                    index,
                    active: false,
                };
                await this.updateAddressInfoActivity(addressInfo);

                // Store address
                this.ext_addresses.push(addressInfo);

                if (!addressInfo.active) inactiveAddressGapWidth++;
                if (inactiveAddressGapWidth >= INACTIVE_ADDRESS_GAP) break;
            }

            /**
             * INTERNAL ADDRESSES
             */

            inactiveAddressGapWidth = 0;

            for (const addressInfo of this.int_addresses) {
                if (addressInfo.active) {
                    // TODO: Update tx history (with low priority)
                    continue;
                }

                await this.updateAddressInfoActivity(addressInfo);

                if (!addressInfo.active) inactiveAddressGapWidth++;
                if (inactiveAddressGapWidth >= INACTIVE_ADDRESS_GAP) break;
            }

            while (inactiveAddressGapWidth < INACTIVE_ADDRESS_GAP) {
                // Derive next address
                const index = this.int_addresses.length;
                const node = xPub
                    .derive(1) // 1 for internal addresses
                    .derive(index);
                const scriptPubKey = nodeToNestedWitnessScriptPubKey(node);
                const address = scriptPubKeyToAddress(scriptPubKey);

                const addressInfo = {
                    scriptPubKey,
                    address,
                    index,
                    active: false,
                };
                await this.updateAddressInfoActivity(addressInfo);

                // Store address
                this.int_addresses.push(addressInfo);

                if (!addressInfo.active) inactiveAddressGapWidth++;
                if (inactiveAddressGapWidth >= INACTIVE_ADDRESS_GAP) break;
            }
        },
    },
    mounted() {
        Nimiq.WasmHelper.doImport().then(() => this.isNimiqLoaded = true);
        ElectrumApi.subscribeHeaders((header) => this.onHeadChanged(header));
    },
    methods: {
        async updateAddressInfoActivity(addressInfo) {
            // const balances = await ElectrumApi.getBalance(addressInfo.scriptPubKey);
            console.log('Fetching tx history for', addressInfo.address);
            const txCount = await this.fetchTxHistory(addressInfo.scriptPubKey);
            addressInfo.active = /* balances.confirmed > 0 || balances.unconfirmed > 0 || */ txCount > 0;
            return addressInfo;
        },
        async fetchTxHistory(scriptPubKey) {
            // Fetch tx history
            const txs = await ElectrumApi.getHistory(scriptPubKey);
            console.log('Tx history:', txs);
            /** @type {{[hash: string]: Transaction}} */
            const txsObj = {};
            for (const tx of txs) {
                // if (!tx.block_height) {
                //     SmartBit.subscribeTransaction(tx.txid);
                // }
                txsObj[tx.txid] = tx;
            }
            this.txs = {
                ...this.txs,
                ...txsObj,
            };

            return txs.length;
        },
        async onStatusChanged(status) {
            if (status === null) return; // No transactions

            // Status is an array of {tx_hash, height} objects

            // Compare status against known status, find new and updated transactions
            const newTxs = [];
            const changedTxs = [];
            for (const entry of status) {
                const knownTx = this.txs[entry.tx_hash];
                if (!knownTx) newTxs.push(entry);
                else if (knownTx.block_height !== entry.height) changedTxs.push(entry);
            }

            console.log(`onStatusChanged: found ${newTxs.length} new txs and ${changedTxs.length} changed txs`);

            // Fetch new transactions
            for (const entry of newTxs) {
                ElectrumApi.getTransaction(entry.tx_hash, entry.height).then((tx) => this.addTransaction(tx));
            }

            // Fetch updated block header
            for (const entry of changedTxs) {
                ElectrumApi.getBlockHeader(entry.height).then((blockHeader) => {
                    this.updateTransaction({
                        txid: this.txs[entry.tx_hash].txid,
                        block_height: entry.height,
                        block_time: blockHeader.timestamp,
                        block_hash: blockHeader.blockHash,
                    });
                });
            }
        },
        async onHeadChanged(header) {
            this.head = {
                height: header.blockHeight,
                timestamp: header.timestamp,
            };
        },
        addTransaction(tx) {
            console.log('Adding transaction', tx);
            // Mark our output addresses as active
            for (const output of tx.outputs) {
                // let extOrInt = 0; // external
                let addressInfo = this.ext_addresses.find(addrInfo => addrInfo.address === output.address);
                if (!addressInfo) {
                    addressInfo = this.int_addresses.find(addrInfo => addrInfo.address === output.address);
                    // extOrInt = 1; // internal index
                }

                if (!addressInfo) continue;
                addressInfo.active = true;

                // TODO: Generate new, unused, address
            }
            this.$set(this.txs, tx.txid, tx);
        },
        updateTransaction(partialTx) {
            console.log('Updating transaction', partialTx);
            const tx = this.txs[partialTx.txid];
            for(const key in partialTx) {
                if (key === 'txid') continue;
                tx[key] = partialTx[key];
            }
        },
        signTransaction() {
            const to = this.txTo;
            const amount = this.txAmount * 1e5;
            const feePerByte = this.txFeePerByte;

            // Find UTXOs that fulfill the amount + fee
            const { utxos, requiresChange } = TxUtils.selectOutputs(this.utxos, amount, feePerByte);
            if (!utxos.length) throw new Error('Could not find UTXOs to match the amount!');

            // Derive keys for selected UTXOs
            const keyMap = utxos.reduce((map, utxo) => {
                const address = utxo.address;
                if (map.has(address)) return map;

                // Find derivation index for UTXO address
                const addressInfo = (utxo.isInternal ? this.int_addresses : this.ext_addresses)
                    .find(addrInfo => addrInfo.address === address);
                if (!addressInfo) throw new Error('Cannot find address info for UTXO address');

                const key = this.accountExtPrivKey.derivePath(`${utxo.isInternal ? 1 : 0}/${addressInfo.index}`);
                map.set(address, key);
                return map;
            }, new Map());

            const redeemableUtxos = utxos.map(utxo => ({
                ...utxo,
                redeemScript: nodeToNestedWitnessRedeemScript(keyMap.get(utxo.address)),
            }));

            const tx = TxUtils.makeTransaction(
                [...keyMap.values()],
                redeemableUtxos,
                to,
                amount,
                requiresChange ? this.nextChangeAddress.address : null,
                feePerByte,
            );
            this.signedTx = tx.toHex();
        },
        async broadcastTransaction() {
            const tx = await ElectrumApi.broadcastTransaction(this.signedTx);
            this.addTransaction(tx)
            console.log(tx.txid);

            alert('Broadcast: ' + tx.txid);

            this.txTo = '';
            this.txAmount = 0;
            this.txFeePerByte = 1;
            this.signedTx = '';
        },
        async subscribeAddress(address) {
            const addressInfo = this.int_addresses.find((addressInfo) => addressInfo.address === address)
                || this.ext_addresses.find((addressInfo) => addressInfo.address === address)
            const scriptPubKey = addressInfo.scriptPubKey;

            try {
                await ElectrumApi.subscribeStatus(scriptPubKey, (status) => this.onStatusChanged(status));
                alert('Ok, subscribed');
            } catch (error) {
                alert('Error: ' + error.message);
            }
        },
    },
});

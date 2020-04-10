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
 *     confirmations: number,
 *     version: number,
 *     seen_time: number,
 *     vsize: number,
 *     fee: number,
 *     inputs: Input[],
 *     outputs: Output[],
 * } Transaction
 */

async function updateAddressInfoActivity(addressInfo) {
    /** @type {AddressStats} */
    const stats = await SmartBit.fetchAddressStats(addressInfo.address);
    addressInfo.active = !!stats.txCount;
    return addressInfo;
}

INACTIVE_ADDRESS_GAP = 1; // As soon as one inactive address is found, search stops

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
                const timestamp1 = tx1.confirmations ? tx1.block_height : Number.MAX_SAFE_INTEGER;
                const timestamp2 = tx2.confirmations ? tx2.block_height : Number.MAX_SAFE_INTEGER;
                return timestamp2 - timestamp1;
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
                        script: NodeBuffer.Buffer.from(output.script, 'hex'),
                        value: output.value,
                    },
                    // Extra properties requried for tx building to work:
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

                await updateAddressInfoActivity(addressInfo);

                if (!addressInfo.active) inactiveAddressGapWidth++;
                if (inactiveAddressGapWidth >= INACTIVE_ADDRESS_GAP) break;

                await this.fetchTxHistory(addressInfo.address);
            }

            while (inactiveAddressGapWidth < INACTIVE_ADDRESS_GAP) {
                // Derive next address
                const index = this.ext_addresses.length;
                const node = xPub
                    .derive(0) // 0 for external addresses
                    .derive(index);
                const address = nodeToNestedWitnessAddress(node);

                const addressInfo = {
                    address,
                    index,
                    active: false,
                };
                await updateAddressInfoActivity(addressInfo);

                // Store address
                this.ext_addresses.push(addressInfo);

                if (!addressInfo.active) inactiveAddressGapWidth++;
                if (inactiveAddressGapWidth >= INACTIVE_ADDRESS_GAP) break;

                await this.fetchTxHistory(addressInfo.address);
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

                await updateAddressInfoActivity(addressInfo);

                if (!addressInfo.active) inactiveAddressGapWidth++;
                if (inactiveAddressGapWidth >= INACTIVE_ADDRESS_GAP) break;

                await this.fetchTxHistory(addressInfo.address);
            }

            while (inactiveAddressGapWidth < INACTIVE_ADDRESS_GAP) {
                // Derive next address
                const index = this.int_addresses.length;
                const node = xPub
                    .derive(1) // 1 for internal addresses
                    .derive(index);
                const address = nodeToNestedWitnessAddress(node);

                const addressInfo = {
                    address,
                    index,
                    active: false,
                };
                await updateAddressInfoActivity(addressInfo);

                // Store address
                this.int_addresses.push(addressInfo);

                if (!addressInfo.active) inactiveAddressGapWidth++;
                if (inactiveAddressGapWidth >= INACTIVE_ADDRESS_GAP) break;

                await this.fetchTxHistory(addressInfo.address);
            }
        },
    },
    mounted() {
        Nimiq.WasmHelper.doImport().then(() => this.isNimiqLoaded = true);
        SmartBit.on('transaction-added', (tx) => this.addTransaction(tx));
        SmartBit.on('transaction-mined', (partialTx) => this.updateTransaction(partialTx));
    },
    methods: {
        async fetchTxHistory(address) {
            // Fetch tx history
            const txs = await SmartBit.fetchTxs(address);
            /** @type {{[hash: string]: Transaction}} */
            const txsObj = {};
            for (const tx of txs) {
                txsObj[tx.txid] = tx.block_height ? Object.freeze(tx) : tx;
            }
            this.txs = {
                ...this.txs,
                ...txsObj,
            };
        },
        addTransaction(tx) {
            console.log('Adding transaction', tx);
            // Mark our output addresses as active
            for (const output of tx.outputs) {
                let extOrInt = 0; // external
                let addressInfo = this.ext_addresses.find(addrInfo => addrInfo.address === output.address);
                if (!addressInfo) {
                    addressInfo = this.int_addresses.find(addrInfo => addrInfo.address === output.address)
                    extOrInt = 1; // internal index
                }

                if (!addressInfo) continue;
                addressInfo.active = true;

                // TODO: Generate new, unused, address
            }
            this.$set(this.txs, tx.txid, tx.block_height ? Object.freeze(tx) : tx);
        },
        updateTransaction(partialTx) {
            console.debug('Updating transaction', partialTx);
            const tx = {
                ...this.txs[partialTx.txid],
                partialTx,
            };
            this.addTransaction(tx);
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
            const response = await SmartBit.pushTx(this.signedTx);
            console.log(response);

            alert('Broadcast: ' + response.success ? response.txid : response.error.message);

            this.txTo = '';
            this.txAmount = 0;
            this.txFeePerByte = 1;
            this.signedTx = '';
        },
        async subscribeCurrentReceiveAddress() {
            try {
                await SmartBit.subscribeAddresses(this.nextReceivingAddress.address);
                alert('Ok, subscribed');
            } catch (error) {
                alert('Error: ' + error.message);
            }
        },
    },
});

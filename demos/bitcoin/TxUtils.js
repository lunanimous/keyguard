/**
 * @typedef {{hash: string, index: number, witnessUtxo: {script: Buffer, value: number}, address: string, isInternal: boolean} UTXO
 */

class TxUtils {
    /**
     * Constructs a transaction to a single recipient with a single amount,
     * from any inputs for which keyPairs are provided.
     *
     * @param {{privateKey: Uint8Array, publicKey: Uint8Array}[]} keyPairs
     * @param {UTXO[]} inputs
     * @param {string} to
     * @param {number} amount
     * @param {string} [changeAddress]
     * @param {number} [feePerByte]
     * @returns {BitcoinJS.Transaction}
     */
    static makeTransaction(keyPairs, inputs, to, amount, changeAddress, feePerByte = 1) {
        const estimatedFee = this.estimateFees(inputs.length, changeAddress ? 2 : 1, feePerByte);
        console.debug('Estimated fee:', estimatedFee);

        // Calculate sum of all inputs (for later use)
        const inputValue = inputs.reduce((sum, input) => sum + input.witnessUtxo.value, 0);
        const estimatedChange = inputValue - amount - estimatedFee;

        if (estimatedChange < 0) throw new Error('Value of inputs is lower than transaction amount + estimated fee');

        // Sort inputs by tx hash ASC, then index ASC
        inputs.sort((input1, input2) => {
            if (input1.hash !== input2.hash) return input1.hash < input2.hash ? -1 : 1;
            return input1.index - input2.index;
        });
        console.debug('Inputs:', inputs);

        // Construct PSBT
        const psbt = new BitcoinJS.Psbt({ network: BitcoinJS.networks.testnet });

        // Add inputs
        psbt.addInputs(inputs);

        // Construct outputs
        const outputs = [{
            address: to,
            value: amount,
        }, ...(changeAddress ? [{
            address: changeAddress,
            value: estimatedChange,
        }] : [])];

        // Sort outputs by value ASC, then address ASC
        outputs.sort((output1, output2) => {
            return (output1.value - output2.value) || (output1.address < output2.address ? -1 : 1);
        });
        console.debug('Outputs:', outputs);

        // Add outputs
        psbt.addOutputs(outputs);

        // Sign
        for (const keyPair of keyPairs) psbt.signAllInputs(keyPair);

        // Finalize
        psbt.finalizeAllInputs();

        // Validate that fee rate is similar to feePerByte argument
        console.debug("Fee rates:", psbt.getFeeRate(), psbt.getFee());

        // Extract tx
        const tx = psbt.extractTransaction();

        console.debug('Size:', tx.virtualSize());

        // Return tx
        return tx;
    }

    /**
     * @param {number} numInputs
     * @param {number} numOutputs
     * @param {number} [feePerByte]
     * @returns {number}
     */
    static estimateFees(numInputs, numOutputs, feePerByte = 1) {
        // Transaction Virtual Sizes
        // Single input, single output: 110 bytes
        // Single input, two outputs: 141 bytes
        // Two inputs, single output: 178 bytes
        // Two inputs, two outputs: 208 bytes

        // Estimate fee
        const estimatedVSize =
            this.TX_BASE_VSIZE /* Tx header */ +
            this.INPUT_VSIZE /* Per input */ * numInputs +
            this.OUPUT_VSIZE /* Per output */ * numOutputs;

        return estimatedVSize * feePerByte;
    }

    /**
     * @param {UTXO[]} utxos
     * @param {number} amount
     * @param {number} [feePerByte]
     * @returns {{utxos: UTXO[], requiresChange: boolean}}
     */
    static selectOutputs(utxos, amount, feePerByte) {
        // Group UTXOs by address and sort by value
        /** @type {{address: string, balance: number, count: number}[]} */
        const balances = Object.values(
            utxos
                .map(utxo => ({address: utxo.address, balance: utxo.witnessUtxo.value}))
                .reduce((obj, utxo) => {
                    const existingBalance = obj[utxo.address];
                    if (existingBalance) {
                        existingBalance.balance += utxo.balance;
                        existingBalance.count += 1;
                    } else {
                        obj[utxo.address] = {
                            ...utxo,
                            count: 1,
                        };
                    }
                    return obj;
                }, {})
        ).sort((a, b) => a.balance - b.balance);

        // Sum up outputs until we find a sum that is bigger than the amount + fees
        let sum = 0;
        let outputCount = 0;
        let requiresChange = false;
        const addresses = [];

        for (const balanceObj of balances) {
            addresses.push(balanceObj.address);
            sum += balanceObj.balance;
            outputCount += balanceObj.count;

            if (sum < amount) continue;

            const feeWithChange = this.estimateFees(outputCount, 2, feePerByte);
            const feeWithoutChange = this.estimateFees(outputCount, 1, feePerByte);

            if (sum >= amount + feeWithChange + this.DUST_AMOUNT) {
                console.debug('Found a combi that DOES require a change output');
                requiresChange = true;
                break;
            }

            if (sum >= amount + feeWithoutChange) {
                console.debug('Found a combi that DOES NOT require a change ouput');
                requiresChange = false;
                break;
            }
        }

        return {
            utxos: utxos.filter(utxo => addresses.includes(utxo.address)),
            requiresChange,
        }
    }
}

TxUtils.TX_BASE_VSIZE = 12;
TxUtils.INPUT_VSIZE = 91;
TxUtils.OUPUT_VSIZE = 32;

// The amount which does not warrant a change output, since it would cost more in fees to include than it's worth
TxUtils.DUST_AMOUNT = TxUtils.INPUT_VSIZE * 2;

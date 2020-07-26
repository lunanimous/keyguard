function nodeToNativeWitnessAddress(node) {
    return BitcoinJS.payments.p2wpkh({
        pubkey: node.publicKey,
        network: TEST.network,
    }).address;
}

function nodeToNestedWitnessAddress(node) {
    return BitcoinJS.payments.p2sh({
        redeem: BitcoinJS.payments.p2wpkh({
            pubkey: node.publicKey,
            network: TEST.network,
        }),
    }).address;
}

function nodeToNestedWitnessRedeemScript(node) {
    return BitcoinJS.payments.p2wpkh({
        pubkey: node.publicKey,
        network: TEST.network,
    }).output;
}

function nodeToNestedWitnessScriptPubKey(node) {
    return BitcoinJS.payments.p2sh({
        redeem: BitcoinJS.payments.p2wpkh({
            pubkey: node.publicKey,
            network: TEST.network,
        }),
    }).output;
}

function scriptPubKeyToAddress(script) {
    return BitcoinJS.address.fromOutputScript(script, TEST.network);
}

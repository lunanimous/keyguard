// Segwit uses BIP84 to derive Bech32 addresses

const DERIVATION_PATH_ACCOUNT = "m/49'/1'/0'"; // m/84'/1'/0'/0: 84' is for BIP84, 1' is for testnet, 0' is for account 0
const DERIVATION_PATH_EXT = DERIVATION_PATH_ACCOUNT + "/0"; // 0 is for external (receiving)
const DERIVATION_PATH_CHG = DERIVATION_PATH_ACCOUNT + "/1"; // 1 is for internal (change)

/**
 * All test vectors were created with https://iancoleman.io/bip39/
 */

const TEST = {};

TEST.mnemonic = 'rib dream attitude script click hope aisle orphan flat early athlete twelve toy sell cigar ugly drink flavor power common devote love relax capable';
TEST.seed = '4e99e97cfb3dd66c0aff61be106a81f9adef10995a39d1bbf43e9b97bc456bee7527ac44400ab1e7d8203b5fdfa4eaedfdf953f5b409b98f819a3145b08cc2c6';
TEST.network = {
    ...BitcoinJS.networks.testnet,
    bip32: { // See https://github.com/satoshilabs/slips/blob/master/slip-0132.md#registered-hd-version-bytes
        // public: 0x045f1cf6, // vpub (BIP84, native SegWit)
        // private: 0x045f18bc, // vprv (BIP84, native SegWit)
        public: 0x044a5262, // upub (BIP49, nested SegWit)
        private: 0x044a4e28, // uprv (BIP49, nested SegWit)
    },
};

TEST.ext_privatekeyWIFs = [ // WIF - Wallet Import Format
    'cSRVQNSD7ASBrTEdr245AjtcxfH7VZ7v5N1A42Vqy72pV6uVfKQd', // 0
    'cR2QckfyU3hQbjCnTt1XeMn4qc7crDJGTo6YKdXQr8oUxB9jH4gr', // 1
    'cVPXsCx6MkvtuLfvjLompkXd599BgCehrtfrcS2xkgCJ9DxLUojr', // 2
    'cTxAM5p6Yn64yPAjs3bT9V8PnLLdVCvj7A2gw8bFmCT8cHSKTjPz', // 3
    'cVLEFkqsB9dFU686ddWiyXSRLjHB4eFKU9m1A7ZDnS9k5x3CTBAz', // 4
    'cMnCMZrTuVTfaWLdoDqH3bNArffXNz2h4nRbes1LWaN9xqv1TszL', // 5
    'cTfE2MwBHgzvRzBZckJDu467AVEg5Y2d558ywQsgdGjRQqeMbtGt', // 6
    'cVK2zTgFaiqYq3s6K32ETNvcmHXxBsBjgdR6ea7sWYtYAuHRTENL', // 7
    'cNa2o499quhygRWc9Em9jUVpWGY1p6kjfqzZjGQrWr9cwTxXvLha', // 8
    'cTm1qmJu6KPwJpPWjTNvNmSLGw65Ams55J3sF654XFbSMsVcXse3', // 9
];

TEST.ext_privatekeys = TEST.ext_privatekeyWIFs.map(wif => BitcoinJS.ECPair.fromWIF(wif, BitcoinJS.networks.testnet).privateKey);
TEST.ext_privatekeys_hex = TEST.ext_privatekeys.map(pk => Nimiq.BufferUtils.toHex(pk));

TEST.ext_addresses = [
    'tb1qsn4ehj7epnnaxdsfjgjeujumsxppt2tql9m9gl', // 0 - This address received 0.08005992 tBTC on March 25, 2020
    'tb1qm37aps59r86g79jg5xh8ecgfqfncv92wzfyyx7', // 1
    'tb1qjpv0wk5p07kdack2ky8jk4dnwnfqgx5cmt3r6l', // 2
    'tb1qhwlha0zaj5ly6jpdeq8uzwk0dj0hfqs6kdu49e', // 3
    'tb1qm600qzjdcc2syufar9suyt50ks3y0s4u46un04', // 4
    'tb1qv05qywlcplqhtd9tsklm9rht9jdjyz5rqkngvt', // 5
    'tb1qtscsd2u3hxjy5dxst5txxpuc52z8djx05hxnsx', // 6
    'tb1q4f4an0rfgv3gy05c3kkfq3m45dmgrdaewllsct', // 7
    'tb1qv6dwfw7ywuse20grmj59rmc0rk2hhu8gf2579q', // 8
    'tb1q9e00ea2tjanlc7kmzqa0nvz007we95h2tdns5x', // 9
];

TEST.chg_privatekeyWIFs = [ // WIF - Wallet Import Format
    'cPr6o2Se6mGDQzgRmk6xyocqnsosuy8QzBmqwRUP4X7VLPzeBZJa', // 0
    'cQzWdbzLw4caGadQR8s4xj3L8Q59HD8nzUMG6cHT4AkPEe5nvKie', // 1
    'cQ3CsehgfkH1sHRUTvDttoNSToFjAjtrJVBT32V1YfiJSocW2z6n', // 2
    'cUC8tq1r6V3ZdzWXZv37LBYZGF8EEzLZdPeX5svHAbG5KECxvdh9', // 3
    'cRSH6qsa5ogFyMdBUSqNrXLz9MLGkyZeDz53dy6eri3nbtkZB75Y', // 4
    'cT7pHHypMy67LFmstoWg8wgmPKSUDEzvnvxL6cciQ85qYneYm93q', // 5
    'cPVWJp8i39TrdCGLHLoYMfpCzaTZ4n76hX7K6TZo8qm1ommuCTn5', // 6
    'cUYEYTkY2E9158QmnKbMDq29cN4ucw8jUUfPBoPs39rg1kuxzNB1', // 7
    'cQw1gssoBkYyFnGbFEMB4pMeuMTkabPdZdXwCxducG5a71J6fFxm', // 8
    'cNKf96md9XR6pmbMpCYbYGaQdKETF8VsQjrG8W1eKqKJXGrkEAnu', // 9
];

TEST.chg_privatekeys = TEST.chg_privatekeyWIFs.map(wif => BitcoinJS.ECPair.fromWIF(wif, BitcoinJS.networks.testnet).privateKey);
TEST.chg_privatekeys_hex = TEST.chg_privatekeys.map(pk => Nimiq.BufferUtils.toHex(pk));

TEST.chg_addresses = [
    'tb1qxvrezy277f2035kasl39pls454yjwtgqkfv05z', // 0
    'tb1qug5uhjkd9uh67xxzcq099xn44697dqceagjg69', // 1
    'tb1qneprztu9xnq0ngv8c42trlqyjea0stxww4xnnd', // 2
    'tb1qm235aln7xyewr5kyckrta7xp29xurt7hdjvjyr', // 3
    'tb1q7asr2m6kz20cmwsvxwzeuxjk7cy7v4yjczt3zh', // 4
    'tb1q7yk3pmjnzfrg8g2ra4shdatdxdc52sed5rz0m0', // 5
    'tb1qnlz0naucldpc9jzphap52j3qw5p203j24we3wp', // 6
    'tb1qnuskus450zx95lwdczgx32jrssxmv2rmvy85em', // 7
    'tb1q8ss6xqy4ztwe5nn7ggl42ns82txylamhtscsuu', // 8
    'tb1q24zm9uytqjgefk30x8ttk8yupd6dwncnuje55g', // 9
];

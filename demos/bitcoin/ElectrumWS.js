/**
 * @param {string} str
 * @returns {Uint8Array}
 */
function stringToBytes(str) {
    const encoder = new TextEncoder(); // utf-8 is the default
    return encoder.encode(str);
}

/**
 * @param {BufferSource} bytes
 * @returns {string}
 */
function bytesToString(bytes) {
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(bytes);
}

function hexToBytes(hex) {
    return new Uint8Array((hex.match(/.{2}/g) || []).map(byte => parseInt(byte, 16)));
}

const HEX_ALPHABET = '0123456789abcdef';

function bytesToHex(bytes) {
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
        const code = bytes[i];
        hex += HEX_ALPHABET[code >>> 4];
        hex += HEX_ALPHABET[code & 0x0F];
    }
    return hex;
}

/**
 * @param {string|Uint8Array} scriptPubKey
 * @returns {Promise<string>}
 */
async function pubKeyToHash(scriptPubKey) {
    if (typeof scriptPubKey === 'string') {
        // From HEX to bytes
        scriptPubKey = hexToBytes(scriptPubKey);
    }

    // Hash with SHA256
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', scriptPubKey));

    // Reverse bytes
    const reversed = new Uint8Array(Array.from(hash).reverse());

    // Convert into HEX
    return bytesToHex(reversed);
}

const ENDPOINT = 'wss://api.nimiqwatch.com:50002';

class ElectrumWS {
    constructor(endpoint = ENDPOINT, options = {}) {
        this._options = Object.assign({
            proxy: false,
            network: 'testnet',
            // reconnect: true, // Not yet implemented
        }, options);

        /** @type {Map<number, {resolve: (result: any) => any, reject: (error: Error) => any}>} */
        this._requests = new Map();

        /** @type {Map<string, (payload: any) => any>} */
        this._subscriptions = new Map();

        this._connected = new Promise((resolve, reject) => {
            this._connectedResolver = resolve;
            this._connectedRejector = reject;
        });
        this._pingInterval = -1;

        this.ws = new WebSocket(`${endpoint}?token=${this._options.network}`, 'binary');
        this.ws.binaryType = 'arraybuffer';

        this.ws.addEventListener('open', this._onOpen.bind(this));
        this.ws.addEventListener('message', this._onMessage.bind(this));
        this.ws.addEventListener('error', this._onError.bind(this));
        this.ws.addEventListener('close', this._onClose.bind(this));
    }

    async request(method, ...params) {
        console.debug('ElectrumWS SEND:', method, ...params);
        /** @type {number} */
        let id;
        do {
            id = Math.ceil(Math.random() * 1e5);
        } while (this._requests.has(id));

        const payload = {
            jsonrpc: "2.0",
            method,
            params,
            id,
        };

        const promise = new Promise((resolve, reject) => {
            this._requests.set(id, {
                resolve,
                reject,
            });
        });

        await this._connected;

        this.ws.send(stringToBytes(JSON.stringify(payload) + (this._options.proxy ? '\n' : '')));

        return promise;
    }

    /**
     * @param {string} method
     * @param {(payload: any) => any} callback
     * @param {any[]} params
     */
    async subscribe(method, callback, ...params) {
        method = `${method}.subscribe`;
        const subscriptionKey = `${method}${typeof params[0] === 'string' ? `-${params[0]}` : ''}`;
        this._subscriptions.set(subscriptionKey, callback);

        callback(await this.request(method, ...params));
    }

    /**
     * @param {string} method
     * @param {any[]} params
     */
    async unsubscribe(method, ...params) {
        method = `${method}.subscribe`;
        const subscriptionKey = `${method}${typeof params[0] === 'string' ? `-${params[0]}` : ''}`;
        this._subscriptions.delete(subscriptionKey);

        return this.request(`${method}.unsubscribe`, ...params);
    }

    _onOpen() {
        console.debug('ElectrumWS OPEN');
        this._connectedResolver();
        this._pingInterval = setInterval(() => this.request('server.ping'), 30 * 1000); // Send ping every 30s
    }

    _onMessage(msg) {
        const response = JSON.parse(bytesToString(msg.data));
        console.debug('ElectrumWS MSG:', response);

        if ('id' in response && this._requests.has(response.id)) {
            const callbacks = this._requests.get(response.id);
            this._requests.delete(response.id);

            if ("result" in response) callbacks.resolve(response.result);
            else callbacks.reject(new Error(response.error || 'No result'));
        }

        if ('method' in response && /** @type {string} */ (response.method).endsWith('subscribe')) {
            const method = response.method;
            const params = response.params;
            const subscriptionKey = `${method}${typeof params[0] === 'string' ? `-${params[0]}` : ''}`;
            if (this._subscriptions.has(subscriptionKey)) {
                const callback = this._subscriptions.get(subscriptionKey);
                callback(...params);
            }
        }
    }

    _onError(err) {
        console.error('ElectrumWS ERROR:', err);
    }

    _onClose(event) {
        console.warn('ElectrumWS CLOSED:', event);
        this._connectedRejector();
        this._connected = new Promise((resolve, reject) => {
            this._connectedResolver = resolve;
            this._connectedRejector = reject;
        });
        clearInterval(this._pingInterval);
    }
}

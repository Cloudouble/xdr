export default {
    serialize: function (value) {
        let buffer, view
        switch (typeof value) {
            case 'undefined':
                return new Uint8Array(0)
            case 'bigint':
                buffer = new ArrayBuffer(32)
                view = new DataView(buffer)
                const lowBytes = BigInt.asUintN(64, value), highBytes = BigInt.asUintN(64, value >> 64n)
                view.setBigUint64(0, lowBytes, false)
                view.setBigUint64(8, highBytes, false)
                break
            case 'boolean':
                buffer = new ArrayBuffer(4)
                view = new DataView(buffer)
                view.setInt32(0, value ? 1 : 0, false)
                break
            case 'number':
                if (parseInt(value) === value) {
                    if (value >= 0) {
                        // unsigned integer: https://datatracker.ietf.org/doc/html/rfc4506.html#section-4.2
                        buffer = new ArrayBuffer(4)
                        view = new DataView(buffer)
                        view.setUint32(0, value, false)
                    } else {
                        // signed integer: https://datatracker.ietf.org/doc/html/rfc4506.html#section-4.1
                        buffer = new ArrayBuffer(4)
                        view = new DataView(buffer)
                        view.setInt32(0, value, false)
                    }
                } else {
                    if (Math.fround(value) === value) {
                        // single-precision floating point: https://datatracker.ietf.org/doc/html/rfc4506.html#section-4.6
                        buffer = new ArrayBuffer(4)
                        view = new DataView(buffer)
                        view.setFloat32(0, value, false)
                    } else if (Number.isFinite(value)) {
                        // double-precision floating point: https://datatracker.ietf.org/doc/html/rfc4506.html#section-4.7
                        buffer = new ArrayBuffer(8)
                        view = new DataView(buffer)
                        view.setFloat64(0, value, false)
                    } else {
                        // quadruple-precision floating point: https://datatracker.ietf.org/doc/html/rfc4506.html#section-4.8
                        throw new Error('Quadruple-precision floating point is not supported')
                    }
                }
                break
            case 'string':
                const valueLength = value.length
                buffer = new ArrayBuffer(4 + Math.ceil(valueLength / 4) * 4)
                view = new DataView(buffer)
                view.setUint32(0, valueLength, false)
                for (let i = 0; i < valueLength; i++) view.setUint8(4 + i, value.charCodeAt(i))
                break
            case 'object':
                if (value === null) return new Uint8Array(0)
                if (Array.isArray(value)) {
                    const valueLength = value.length, valueArrays = value.map(v => Array.from(this.serialize(v))),
                        combinedArray = [].concat(Array.from(this.serialize(valueLength)), ...valueArrays)
                    buffer = new ArrayBuffer(combinedArray.length)
                    view = new DataView(buffer)
                    for (let i = 0; i < combinedArray.length; i++) view.setUint8(i, combinedArray[i])
                } else {
                    return this.serialize(Object.entries(value))
                }
        }
        return new Uint8Array(buffer)
    },
    deserialize: function () { },
    parse: function (str) {
        const s = []
        for (const b in atob(str)) s.push(b.charCodeAt())
        return s
    },
    stringify: function (value) {
        const s = []
        const serializedValue = this.serialize(value)
        for (const b of serializedValue) s.push(String.fromCharCode(b))
        return btoa(s.join(''))
    },
    registerType: function () { }
}


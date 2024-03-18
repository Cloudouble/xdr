export default {
    serialize: function (value) {
        let buffer, view
        switch (typeof value) {
            case 'undefined':
                return new Uint8Array(0)
            case 'bigint':
                buffer = new ArrayBuffer(16)
                view = new DataView(buffer)
                view.setBigUint64(0, BigInt.asUintN(64, value), false)
                view.setBigUint64(8, BigInt.asUintN(64, value >> 64n), false)
                break
            case 'boolean':
                buffer = new ArrayBuffer(4)
                view = new DataView(buffer)
                view.setUint32(0, value ? 1 : 0, false)
                break
            case 'number':
                if (Number.isInteger(value)) {
                    if (value >= 0) {
                        // unsigned integer
                        buffer = new ArrayBuffer(4)
                        view = new DataView(buffer)
                        view.setUint32(0, value, false)
                    } else {
                        // signed integer
                        buffer = new ArrayBuffer(4)
                        view = new DataView(buffer)
                        view.setInt32(0, value, false)
                    }
                } else {
                    if (Math.fround(value) === value) {
                        // single-precision floating point
                        buffer = new ArrayBuffer(4)
                        view = new DataView(buffer)
                        view.setFloat32(0, value, false)
                    } else if (Number.isFinite(value)) {
                        // double-precision floating point
                        buffer = new ArrayBuffer(8)
                        view = new DataView(buffer)
                        view.setFloat64(0, value, false)
                    } else {
                        // quadruple-precision floating point
                        throw new Error('Quadruple-precision floating point is not supported')
                    }
                }
                break
            case 'string':
                const encoder = new TextEncoder()
                const encodedValue = encoder.encode(value)
                const valueLength = encodedValue.length
                buffer = new ArrayBuffer(4 + Math.ceil(valueLength / 4) * 4)
                view = new DataView(buffer)
                view.setUint32(0, valueLength, false)
                const uint8Array = new Uint8Array(buffer, 4)
                uint8Array.set(encodedValue)
                break
            case 'object':
                if (value === null) {
                    return new Uint8Array(0)
                }
                if (Array.isArray(value)) {
                    const serializedArray = value.map(item => this.serialize(item))
                    const totalLength = serializedArray.reduce((acc, arr) => acc + arr.length, 0)
                    buffer = new ArrayBuffer(4 + totalLength)
                    view = new DataView(buffer)
                    view.setUint32(0, value.length, false)
                    let offset = 4
                    for (const arr of serializedArray) {
                        const uint8Array = new Uint8Array(buffer, offset)
                        uint8Array.set(arr)
                        offset += arr.length
                    }
                } else {
                    const entries = Object.entries(value)
                    const serializedEntries = entries.map(([key, val]) => {
                        const serializedKey = this.serialize(key)
                        const serializedValue = this.serialize(val)
                        return new Uint8Array([...serializedKey, ...serializedValue])
                    })
                    const totalLength = serializedEntries.reduce((acc, arr) => acc + arr.length, 0)
                    buffer = new ArrayBuffer(4 + totalLength)
                    view = new DataView(buffer)
                    view.setUint32(0, entries.length, false)
                    let offset = 4
                    for (const arr of serializedEntries) {
                        const uint8Array = new Uint8Array(buffer, offset)
                        uint8Array.set(arr)
                        offset += arr.length
                    }
                }
                break
            default:
                throw new Error(`Unsupported type: ${typeof value}`)
        }
        return new Uint8Array(buffer)
    }, deserialize: function () { },
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


# SimpleXDR

A library for encoding and decoding XDR data within the browser or browser-like environments.

## Usage

    <script type="module">

        import XDR from "xdr.js"

        const fileBytes = new Uint8Array([
            0x00, 0x00, 0x00, 0x09,
            0x73, 0x69, 0x6c, 0x6c,
            0x79, 0x70, 0x72, 0x6f,
            0x67, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x02,
            0x00, 0x00, 0x00, 0x04,
            0x6c, 0x69, 0x73, 0x70,
            0x00, 0x00, 0x00, 0x04,
            0x6a, 0x6f, 0x68, 0x6e,
            0x00, 0x00, 0x00, 0x06,
            0x28, 0x71, 0x75, 0x69,
            0x74, 0x29, 0x00, 0x00
        ]),
            fileValue = {
                filename: "sillyprog",
                type: {
                    kind: "EXEC",
                    interpretor: "lisp"
                },
                owner: "john",
                data: [0x28, 0x71, 0x75, 0x69, 0x74, 0x29]
            },

            // load type definition from URL to any .X file or direct as a string of XDR type definition code 
            // as per the XDR: External Data Representation Standard 
            // at https://datatracker.ietf.org/doc/html/rfc4506.html

            fileType = await XDR.factory('demo/file.X'),

            // create an instance of the type from either a Uint8Array of regular Array of byte integers 
            fileInstanceFromBytes = new fileType(fileBytes),

            // create an instance of the type from a live object that conforms to the type definition
            fileInstanceFromValue = new fileType(fileValue)

        console.log("From bytes: ", fileInstanceFromBytes)
        console.log("From value: ", fileInstanceFromValue)

        // serialize any conforming value to a Uint8Array of bytes
        console.log("Serialize: ", XDR.serialize(fileValue, fileType))

        // deserialize any Uint8Array of bytes to a live object that conforms to the type definition
        console.log("Deserialize: ", XDR.deserialize(fileBytes, fileType))

        // stringify any conforming value to a base64 string encoding the bytes
        const base64Str = XDR.stringify(fileValue, fileType)

        // parse any base64 string encoding of bytes to a live object that conforms to the type definition
        const parseResult = XDR.parse(base64Str, fileType)

        console.log("Base64 byte string: ", base64Str)

        console.log("Parsed to object: ", parseResult)

        console.log("JSON stringify: ", JSON.stringify(fileInstanceFromBytes))

    </script>

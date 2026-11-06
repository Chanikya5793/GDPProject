import { encodeRequests } from '../src/transformer-encoder.js'
let input = ''
for await (const chunk of process.stdin) input += chunk
try {
  // ONNX may emit progress messages; reserve stdout for the machine-readable result.
  console.log = (...values) => console.error(...values)
  const records = await encodeRequests(JSON.parse(input), message => console.error(message))
  process.stdout.write(JSON.stringify(records))
} catch (error) { console.error(error.stack || error); process.exitCode = 1 }

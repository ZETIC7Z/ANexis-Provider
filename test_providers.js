const { getAnikaiStreams } = require('./providers/anikai');
const { getAnikotoStreams } = require('./providers/anikoto');

async function run() {
    console.log("Testing Anikai...");
    const ani = await getAnikaiStreams('37854', 'tv', 23, 1165); // One Piece
    console.log("Anikai result:", JSON.stringify(ani, null, 2));

    console.log("\nTesting Anikoto...");
    const ak = await getAnikotoStreams('37854', 'tv', 23, 1165);
    console.log("Anikoto result:", JSON.stringify(ak, null, 2));
}
run();

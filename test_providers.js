const { getVsembedStreams } = require('./providers/vsembed');
const { getMovieboxStreams } = require('./providers/moviebox');

async function run() {
    console.log("Testing Vsembed...");
    const vs = await getVsembedStreams('550'); // Fight Club
    console.log("Vsembed result:", JSON.stringify(vs, null, 2));

    console.log("Testing Moviebox...");
    const mb = await getMovieboxStreams('550');
    console.log("Moviebox result:", JSON.stringify(mb, null, 2));
}
run();

// Records finished runs on the Solana devnet and reads them back as a shared leaderboard.
// One record is one transaction signed by the player's Phantom wallet:
//   1. a 0-lamport transfer to the leaderboard address, which tags the transaction so it can be listed later;
//   2. a Memo program instruction holding "SJ1|<difficulty>|<metres>".
// Devnet only: SOL there is free test currency, so nothing of value moves.

// Accepts the memo text as the RPC returns it ("[13] SJ1|hard|1234") and rejects anything malformed.
function parseRunMemo(memo) {
  const m = /^(?:\[\d+\]\s*)?SJ1\|(easy|medium|hard)\|(\d{1,7})$/.exec(String(memo).trim());
  return m && { difficulty: m[1], metres: Number(m[2]) };
}

const Chain = (() => {
  const RPC = 'https://api.devnet.solana.com';
  const LIB = 'https://cdn.jsdelivr.net/npm/@solana/web3.js@1.98.0/lib/index.iife.min.js';
  const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
  const SEED = 'steel-junction-leaderboard-v1';
  let ready = null;

  // The library is about 400 KB, so it loads only when someone uses a Solana feature.
  function setup() {
    ready ||= new Promise((resolve, reject) => {
      const done = () => {
        const w = window.solanaWeb3;
        const memo = new w.PublicKey(MEMO_PROGRAM);
        const [board] = w.PublicKey.findProgramAddressSync([new TextEncoder().encode(SEED)], memo);
        resolve({ w, memo, board, conn: new w.Connection(RPC, 'confirmed') });
      };
      if (window.solanaWeb3) return done();
      const tag = Object.assign(document.createElement('script'), { src: LIB, onload: done });
      tag.onerror = () => {
        ready = null;
        tag.remove();
        reject(new Error('LIB'));
      };
      document.head.append(tag);
    });
    return ready;
  }

  const phantom = () => {
    const p = window.phantom?.solana || window.solana;
    return p?.isPhantom ? p : null;
  };

  async function record(difficulty, metres) {
    const wallet = phantom();
    if (!wallet) throw new Error('NO_WALLET');
    const { w, memo, board, conn } = await setup();
    const { publicKey } = await wallet.connect();
    const tx = new w.Transaction().add(
      w.SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: board, lamports: 0 }),
      new w.TransactionInstruction({
        programId: memo,
        keys: [{ pubkey: publicKey, isSigner: true, isWritable: false }],
        data: new TextEncoder().encode(`SJ1|${difficulty}|${Math.floor(metres)}`),
      }),
    );
    const latest = await conn.getLatestBlockhash();
    tx.recentBlockhash = latest.blockhash;
    tx.feePayer = publicKey;
    // Sign in Phantom, send through our own devnet connection, so it works whatever network Phantom shows.
    const signed = await wallet.signTransaction(tx);
    const signature = await conn.sendRawTransaction(signed.serialize());
    await conn.confirmTransaction({ signature, ...latest }, 'confirmed');
    return signature;
  }

  // Top runs, best first. Anyone can post to devnet, so entries are parsed strictly and shown as text only.
  async function leaderboard(limit = 10) {
    const { conn, board } = await setup();
    const list = await conn.getSignaturesForAddress(board, { limit: 300 });
    const runs = list
      .filter((s) => !s.err && s.memo)
      .map((s) => ({ ...parseRunMemo(s.memo), signature: s.signature }))
      .filter((r) => r.difficulty)
      .sort((a, b) => b.metres - a.metres)
      .slice(0, limit);
    if (!runs.length) return runs;
    const txs = await conn.getParsedTransactions(runs.map((r) => r.signature), { maxSupportedTransactionVersion: 0 });
    return runs.map((r, i) => {
      const signer = txs[i]?.transaction.message.accountKeys.find((k) => k.signer);
      return { ...r, player: signer ? signer.pubkey.toBase58() : '' };
    });
  }

  const explorer = (signature) => `https://explorer.solana.com/tx/${signature}?cluster=devnet`;

  // Turns library and wallet errors into a sentence for the player.
  function explain(err) {
    const text = String(err?.message || err);
    if (text === 'NO_WALLET') return 'Phantom isn\'t installed in this browser. Install it from phantom.com, then try again.';
    if (text === 'LIB') return 'The Solana library didn\'t load. Check your internet connection and try again.';
    if (err?.code === 4001 || /reject|cancel/i.test(text)) return 'You cancelled in Phantom, so nothing was recorded.';
    if (/no record of a prior credit|insufficient/i.test(text)) return 'Your wallet has no devnet SOL to pay the fee. Get free test SOL at faucet.solana.com, then try again.';
    if (/429|fetch|network/i.test(text)) return 'The Solana devnet isn\'t answering right now. Try again in a minute.';
    return 'Something went wrong talking to Solana. Try again in a minute.';
  }

  return { record, leaderboard, explorer, explain };
})();

if (typeof module !== 'undefined') module.exports = { parseRunMemo };

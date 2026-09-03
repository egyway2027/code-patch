/** Browser/Node compatible cryptographic helpers. */
export async function sha256(text){
  const bytes=new TextEncoder().encode(String(text??''));
  if(!globalThis.crypto?.subtle)throw new Error('WebCrypto SHA-256 unavailable; operation rejected rather than using a weak hash.');
  const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}

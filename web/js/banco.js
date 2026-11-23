// Guarda as dancas importadas (video + coreografia) no IndexedDB do navegador.
const NOME = 'passinho';
const LOJA = 'dancas';

let promessaBanco;
function abrir() {
  if (!promessaBanco) {
    promessaBanco = new Promise((ok, erro) => {
      const req = indexedDB.open(NOME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(LOJA, { keyPath: 'id' });
      req.onsuccess = () => ok(req.result);
      req.onerror = () => erro(req.error);
    });
  }
  return promessaBanco;
}

async function operar(modo, fn) {
  const db = await abrir();
  return new Promise((ok, erro) => {
    const tx = db.transaction(LOJA, modo);
    const req = fn(tx.objectStore(LOJA));
    tx.oncomplete = () => ok(req?.result);
    tx.onerror = () => erro(tx.error);
    tx.onabort = () => erro(tx.error);
  });
}

export const salvar = (danca) => operar('readwrite', (s) => s.put(danca));
export const obter = (id) => operar('readonly', (s) => s.get(id));
export const apagar = (id) => operar('readwrite', (s) => s.delete(id));

export async function listar() {
  const todas = await operar('readonly', (s) => s.getAll());
  return (todas || []).sort((a, b) => b.criado - a.criado);
}

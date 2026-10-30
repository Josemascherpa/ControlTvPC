// Lo que el Cine guarda entre usos (catálogo, fichas, traducciones), dentro del propio navegador
// (IndexedDB): no depende de la notebook, así la misma app sirve en cualquier tele con internet.
// Si el navegador no deja guardar (modo privado, sin permiso), funciona igual, sólo en memoria.

export interface KeyValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  /** Todo lo guardado (para cargar la memoria al abrir). */
  entries(): Promise<readonly (readonly [string, unknown])[]>;
  /** Deja como mucho `limit` registros: se borran los primeros que se guardaron. */
  trim(limit: number): Promise<void>;
}

export class MemoryStore implements KeyValueStore {
  private readonly data = new Map<string, unknown>();

  get(key: string): Promise<unknown> {
    return Promise.resolve(this.data.get(key));
  }

  set(key: string, value: unknown): Promise<void> {
    this.data.delete(key);
    this.data.set(key, value);
    return Promise.resolve();
  }

  entries(): Promise<readonly (readonly [string, unknown])[]> {
    return Promise.resolve([...this.data]);
  }

  trim(limit: number): Promise<void> {
    for (const key of [...this.data.keys()].slice(0, Math.max(0, this.data.size - limit))) this.data.delete(key);
    return Promise.resolve();
  }
}

const DATABASE = 'cine';
const TABLES = ['catalogo', 'traducciones', 'subtitulos'] as const;
export type Table = (typeof TABLES)[number];

let opening: Promise<IDBDatabase> | null = null;

function database(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2);
    request.onupgradeneeded = (): void => {
      for (const table of TABLES) {
        const store = request.result.objectStoreNames.contains(table)
          ? request.transaction?.objectStore(table) : request.result.createObjectStore(table);
        if (store && !store.indexNames.contains('at')) store.createIndex('at', 'at');
      }
    };
    request.onsuccess = (): void => { resolve(request.result); };
    request.onerror = (): void => { reject(request.error ?? new Error('IndexedDB')); };
  });
  return opening;
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = (): void => { resolve(request.result); };
    request.onerror = (): void => { reject(request.error ?? new Error('IndexedDB')); };
  });
}

/** Una tabla de IndexedDB; si no se puede abrir, se usa la memoria. */
export class BrowserStore implements KeyValueStore {
  private readonly fallback = new MemoryStore();
  private broken = typeof indexedDB === 'undefined';

  constructor(private readonly table: Table) {}

  async get(key: string): Promise<unknown> {
    return this.run(async (store) => {
      const record: unknown = await done(store.get(key));
      return isStored(record) ? record.value : undefined;
    }, () => this.fallback.get(key), 'readonly');
  }

  async set(key: string, value: unknown): Promise<void> {
    // Se guarda con la fecha: así trim() sabe cuáles son los más viejos.
    await this.run((store) => done(store.put({ at: Date.now(), value }, key)).then(() => undefined), () => this.fallback.set(key, value));
  }

  async entries(): Promise<readonly (readonly [string, unknown])[]> {
    return this.run(async (store) => {
      const [keys, values] = await Promise.all([done(store.getAllKeys()), done(store.getAll())]);
      return keys.flatMap((key, index): (readonly [string, unknown])[] => {
        const record: unknown = values[index];
        return typeof key === 'string' && isStored(record) ? [[key, record.value]] : [];
      });
    }, () => this.fallback.entries(), 'readonly');
  }

  async trim(limit: number): Promise<void> {
    await this.run(async (store) => {
      let remaining = Math.max(0, await done(store.count()) - limit);
      if (!remaining) return;
      // Sólo claves/fechas: no cargar VTT completos ni miles de sinopsis para borrar los más viejos.
      await new Promise<void>((resolve, reject) => {
        const request = store.index('at').openKeyCursor();
        request.onerror = (): void => { reject(request.error ?? new Error('IndexedDB')); };
        request.onsuccess = (): void => {
          const cursor = request.result;
          if (!cursor || remaining <= 0) { resolve(); return; }
          const deletion = store.delete(cursor.primaryKey);
          deletion.onerror = (): void => { reject(deletion.error ?? new Error('IndexedDB')); };
          remaining--;
          cursor.continue();
        };
      });
    }, () => this.fallback.trim(limit));
  }

  private async run<T>(task: (store: IDBObjectStore) => Promise<T>, otherwise: () => Promise<T>, mode: IDBTransactionMode = 'readwrite'): Promise<T> {
    if (this.broken) return otherwise();
    try {
      const db = await database();
      return await task(db.transaction(this.table, mode).objectStore(this.table));
    } catch {
      this.broken = true; // sin IndexedDB: de acá en más, en memoria
      return otherwise();
    }
  }
}

interface Stored {
  readonly at: number;
  readonly value: unknown;
}

function isStored(value: unknown): value is Stored {
  return typeof value === 'object' && value !== null && 'at' in value && 'value' in value && typeof value.at === 'number';
}

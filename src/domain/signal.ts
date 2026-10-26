/** Un evento simple y tipado: quien quiera se suscribe y se le avisa con el valor. */
export class Signal<T> {
  private readonly listeners = new Set<(value: T) => void>();

  /** Devuelve una función para desuscribirse. */
  subscribe(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(value: T): void {
    for (const listener of this.listeners) listener(value);
  }
}

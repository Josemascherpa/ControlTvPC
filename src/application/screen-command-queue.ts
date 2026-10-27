interface ScreenJob {
  readonly action: () => Promise<void>;
  readonly repeatKey: string | null;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

/** Ordena las operaciones de pantalla sin acumular segundos de flechas cuando una web se atrasa. */
export class ScreenCommandQueue {
  private readonly jobs: ScreenJob[] = [];
  private running = false;

  run(action: () => Promise<void>, repeatKey: string | null = null): Promise<void> {
    // Una flecha en curso y una pendiente bastan para mantener la repetición responsiva.
    // No combinar a través de Enter/texto/cambios de dirección: son barreras de orden.
    if (repeatKey !== null && this.jobs.at(-1)?.repeatKey === repeatKey) return Promise.resolve();
    if (this.jobs.length >= 32) return Promise.reject(new Error('La pantalla está ocupada; demasiadas órdenes pendientes'));
    return new Promise((resolve, reject) => {
      this.jobs.push({ action, repeatKey, resolve, reject });
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      let job: ScreenJob | undefined;
      while ((job = this.jobs.shift())) {
        try {
          await job.action();
          job.resolve();
        } catch (error: unknown) {
          job.reject(error);
        }
      }
    } finally {
      this.running = false;
    }
  }
}

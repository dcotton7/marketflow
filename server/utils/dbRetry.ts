export async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseMs = 200): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt >= attempts) {
        throw err;
      }
      const wait = baseMs * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}


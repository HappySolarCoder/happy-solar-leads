/** A deadline limits UI waiting; it never claims to cancel an underlying write. */
export async function withDeadline<T>(work: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(message), { code: 'raydar/timeout' })), milliseconds);
    })]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

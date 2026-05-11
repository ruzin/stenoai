import type { Result } from './ipc';

export function unwrap<T>(result: Result<T>): T {
  if (!result.success) throw new Error(result.error);
  const { success: _success, ...rest } = result;
  return rest as T;
}

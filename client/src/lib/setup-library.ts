/**
 * The Setup Library is turned off unless the server has SETUP_LIBRARY=on (server/bigidea/setup-library.ts).
 * The client asks the server and hides every way in (the admin button, the page) until it says enabled.
 */
import { useQuery } from "@tanstack/react-query";

export const SETUP_LIBRARY_STATUS_URL = "/api/bigidea/setup-library/status";

/** Hidden unless the status answer says exactly enabled: true (loading, errors and old servers count as off). */
export function setupLibraryEnabled(status: unknown): boolean {
  return !!status && typeof status === "object" && (status as { enabled?: unknown }).enabled === true;
}

export function useSetupLibraryEnabled(): boolean {
  const { data } = useQuery<{ enabled: boolean }>({ queryKey: [SETUP_LIBRARY_STATUS_URL], staleTime: 5 * 60 * 1000, retry: false });
  return setupLibraryEnabled(data);
}

import type { ProjectSessionContext, ProjectSessionSnapshot, ProjectSessionFailure } from "./types";
export const PROJECT_SESSION_CHANGED: string;
export function projectSessionError(code: string, message: string, retryable?: boolean): Error & { code: string; retryable: boolean };
export function projectSessionFailure(error: unknown): ProjectSessionFailure;
export function unwrapProjectSessionResult<T>(value: T | ProjectSessionFailure): T;
export function parseProjectSessionContext(value: unknown): ProjectSessionContext;
export function assertProjectSessionSnapshot(value: unknown): ProjectSessionSnapshot;

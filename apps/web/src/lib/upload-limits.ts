/**
 * Vercel refuses any request body over 4.5 MB before it reaches the app, so files larger than
 * one piece are sent in pieces of this size and joined on the server. Shared by browser and server.
 */
export const UPLOAD_PART_BYTES = 4 * 1024 * 1024;

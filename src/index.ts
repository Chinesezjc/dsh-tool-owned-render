/**
 * Node half of the tool-owned render plugin.
 *
 * Pure UI plugin: the empty apply exists so the package appears in the host
 * cordis.yml / Loader, which is what makes the client-modules scanner discover
 * the browser half declared under package.json `dsh.client`.
 * @module dsh-tool-owned-render
 */

/** Host plugin body — this surface plugin has no host-side behaviour. */
export function apply(): void {}

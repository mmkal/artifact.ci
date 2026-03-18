export default {
  async fetch(): Promise<Response> {
    return new Response('Astro docs worker not wired yet.', {status: 503})
  },
}

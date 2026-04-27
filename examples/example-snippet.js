export default {
  async fetch(request) {
    const requestURL = new URL(request.url);
    const path = requestURL.pathname;

    const siteHostname = "example.com";

    const archivePaths = new Set([
      "/files/2024-01/document-a.pdf",
      "/files/2024-03/document-b.pdf",
      "/files/2024-05/document-c.pdf",
      "/files/2024-11/document-d.pdf",
      "/files/2025-01/document-e.pdf",
      "/files/2025-06/document-f.pdf",
    ]);

    if (archivePaths.has(path) && !requestURL.searchParams.has("archive-consent")) {
      const archiveUrl =
        "https://" + siteHostname + "/archive-notice?archive-url=" + encodeURIComponent(requestURL.href);
      return Response.redirect(archiveUrl, 301);
    }

    return fetch(request);
  },
};
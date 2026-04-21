export default {
  async fetch(request) {
    const requestURL = new URL(request.url);
    const path = requestURL.pathname;

    const siteHostname = "capriverside.org";

    const archivePaths = new Set([
      "/sites/g/files/aldnop136/files/2024-01/Taxpayer%20Consent%20-%20F14446_ENG.pdf",
      "/sites/g/files/aldnop136/files/2024-01/VITA%20Fall%20Ads.pdf",
      "/sites/g/files/aldnop136/files/2024-03/Intake%20-%20f13614c_SP.pdf",
      "/sites/g/files/aldnop136/files/2024-04/Weatherization%20EN-SP%20v2.pdf",
      "/sites/g/files/aldnop136/files/2024-05/VITA%20Summer%20Ad.pdf",
      "/sites/g/files/aldnop136/files/2024-07/Temecula%20-%20Utility%20Assistance%20Clinic%20ENG-SP_v2.pdf",
      "/sites/g/files/aldnop136/files/2024-11/VITA%20Volunteer%20Ad%20-%20WinterV2.pdf",
      "/sites/g/files/aldnop136/files/2024-11/2025%20Tech%20for%20Success%20Desktop%20Flyer.pdf",
      "/sites/g/files/aldnop136/files/2024-12/2025%20LIHEAP%20CAP%20APPLICATION%20ENGLISH.pdf",
      "/sites/g/files/aldnop136/files/2025-01/Form%2013614-C%20(sp)%20Intake%20Interview%20and%20Quality%20Review%20Sheet%20(rev%2011-2024)%20Spanish%20version.pdf",
      "/sites/g/files/aldnop136/files/2025-01/Form%2013614-C%20Intake%20Interview%20and%20Quality%20Review%20Sheet%20(rev%2011-2024)%20English%20version.pdf",
      "/sites/g/files/aldnop136/files/2025-02/2025%20LIHEAP%20CAP%20APPLICATION%20-%20SpanishV2.pdf",
      "/sites/g/files/aldnop136/files/2025-06/RPU%20SHARE%20Program%20Application_ENG_2025_FILLABLE.pdf",
      "/sites/g/files/aldnop136/files/2025-06/RPU%20SHARE%20Program%20Application_SPAN_2025_FILLABLE.pdf",
      "/sites/g/files/aldnop136/files/2025-07/2025%20VITA%20Saturdays%20ENG.pdf",
      "/sites/g/files/aldnop136/files/2025-07/2025%20VITA%20Saturdays%20SP.pdf",
      "/sites/g/files/aldnop136/files/2022-09/2016%20Annual%20Report.pdf",
      "/sites/g/files/aldnop136/files/2022-09/2017%20Annual%20Report.pdf",
      "/sites/g/files/aldnop136/files/2022-09/2018%20Annual%20Report.pdf",
      "/sites/g/files/aldnop136/files/2022-09/2019%20Annual%20Report_0.pdf",
      "/sites/g/files/aldnop136/files/2022-09/2020%20ANNUAL%20REPORT_0.pdf",
    ]);

    if (archivePaths.has(path) && !requestURL.searchParams.has("archive-consent")) {
      const archiveUrl =
        "https://" + siteHostname + "/archive-notice?archive-url=" + encodeURIComponent(requestURL.href);
      return Response.redirect(archiveUrl, 301);
    }

    return fetch(request);
  },
};
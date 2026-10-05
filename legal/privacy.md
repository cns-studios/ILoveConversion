# Privacy Policy - ILC

Version 2.1 · Last updated: Oct 5th, 2026

## 1. Who is responsible

The controller under Art. 4(7) GDPR is:

Aaron Gerkens, operating as CNS Studios
Mittelstraße 79
22869 Schenefeld, Germany
Email: privacy@cns-studios.com

ILC is a free, non-commercial project of CNS Studios, a team of developers. CNS Studios is a brand name, not a company; the person legally responsible is the one named above. We have not appointed a data protection officer because none is required. For any privacy question, write to the address above.

## 2. Short version

- **Local mode:** your files never leave your device. We receive nothing.
- **Online mode:** your file is uploaded, converted on our own server in Germany, and deleted automatically within about an hour.
- No tracking, no analytics scripts, no third-party code on the site.
- All traffic passes through Cloudflare, which can technically see it (section 6).
- We do not sell data, build profiles, or use your files for anything other than converting them.

## 3. Local mode

In local mode, conversion runs entirely inside your browser. Your files are not uploaded, and no file content or filename is sent to our server. Like any website visit, loading the page itself involves your IP address (sections 5 and 6). Local mode loads no third-party resources.

## 4. Online mode

Before using online mode, you must accept the Terms of Service and this Privacy Policy.

| Data | Purpose | Legal basis | Storage period |
|---|---|---|---|
| Uploaded file (input) | Convert it as you requested | Art. 6(1)(b) GDPR (providing the service) | Deleted as soon as processing has finished or failed |
| Converted file (output) | Let you download it | Art. 6(1)(b) GDPR | Deleted 1 hour after completion at the latest, or when you delete it. The cleanup runs every 10 minutes, so deletion can take up to 10 minutes longer. |
| Job record: original and result filename, file sizes, chosen format and settings, timestamps, status, error message | Run the job, show its status, fix errors | Art. 6(1)(b) GDPR | Deleted together with the output |
| IP address with request counters and timestamps (rate-limit record) | Prevent abuse and overload, keep the service fair for everyone | Art. 6(1)(f) GDPR (legitimate interest) | Deleted after 24 hours without a request |
| Server logs: IP address, time, requested URL (including job ID), status code, data volume, duration | Security, error diagnosis, abuse defence | Art. 6(1)(f) GDPR | At most 7 days |

**Filenames** can contain personal information. They are stored only in the job record and are not written to logs.

**Your file content.** Processing is fully automated. We do not open, read, analyse, or share your files, and we do not use them to train anything. Technically we have access to our own server and could decrypt files. We will only look at a file where that is strictly necessary to fix a technical fault or to investigate a specific report of illegal content.

**Encryption.** Files are encrypted on the server's disk (AES-256-GCM, with a separate key per job). They exist unencrypted only in the server's memory (RAM) during processing. This protects against loss or theft of the disk. It does not protect against someone who has full access to the running server, because the master key is stored on that server. We currently do not have any other way of processing files without decrypting them, due to technical limitations.

**Special categories and third-party data.** You may upload files that contain sensitive information or other people's personal data. The server only processes them technically and does not evaluate their content. You are responsible for having the right to upload them (see the Terms of Service).

## 5. Why we process IP addresses

Your IP address is needed to deliver the site and to rate-limit requests. Without rate limiting, a single user could overload servers. We keep these data for as short a time as possible, and we do not use them to identify you, to track you across sessions, or to build profiles. This is our legitimate interest under Art. 6(1)(f) GDPR. You can object (section 11).

## 6. Cloudflare

All traffic to ILC passes through the network of Cloudflare, Inc. (USA), which acts as a protective and delivery layer in front of our server. This covers page loads, local-mode code, and online-mode uploads and downloads.

- Cloudflare ends the encrypted connection (TLS) at its servers and forwards the traffic to ours. **This means Cloudflare can technically see traffic in transit, including files uploaded in online mode and your IP address.** In local mode, Cloudflare only sees the page being loaded, not your files.
- Cloudflare processes this data on our behalf under a data processing agreement (Art. 28 GDPR). It also applies rate limiting for us and provides basic traffic statistics. For its own security and network operation, Cloudflare processes some data as an independent controller. See Cloudflare's privacy policy for details.
- Cloudflare may set technical cookies for security purposes (section 8).
- Legal basis: Art. 6(1)(f) GDPR. Our legitimate interest is a secure, available service protected against attacks.

## 7. Recipients and transfers outside the EU

Recipients: Cloudflare (above) and, only where legally required, public authorities. There are no other service providers. Files and databases are stored on our own servers in Germany.

Cloudflare, Inc. is based in the USA and processes traffic at data centres close to visitors, which can be anywhere in the world. Transfers to Cloudflare, Inc. are covered by its certification under the EU-US Data Privacy Framework (European Commission adequacy decision of 10 July 2023). If that certification or the adequacy decision ceases to apply, the Standard Contractual Clauses included in Cloudflare's data processing agreement apply instead. You can ask us for information about these safeguards.

## 8. Cookies and browser storage

We do not set cookies. Your browser stores your acceptance of the Terms and this Policy locally on your device. This is strictly necessary to provide the function you requested, so no consent is needed (§ 25(2) no. 2 TDDDG). It is never sent to our server for tracking. Cloudflare may set strictly necessary security cookies.

## 9. Automated decisions

There is no automated decision-making or profiling within the meaning of Art. 22 GDPR. Rate limiting only slows or blocks excessive requests.

## 10. Is providing data required?

Nothing is required by law or contract. Local mode needs no data from you. Online mode cannot work without your file and your IP address.

## 11. Your rights

You have the right to access (Art. 15), rectification (Art. 16), erasure (Art. 17), restriction (Art. 18), and data portability (Art. 20). You also have the right to object to processing based on legitimate interests (Art. 21).

Because we have no accounts and cannot identify you from our data, we may ask for the job ID or the IP address concerned, so we can find your data (Art. 11, Art. 12(6) GDPR). Where possible we answer within one month. You can delete your files at any time yourself in online mode; this removes the output and job record immediately.

## 12. Right to complain

You may complain to any data protection supervisory authority. The authority responsible for us is: Unabhängiges Landeszentrum für Datenschutz Schleswig-Holstein.

## 13. Security

Connections are encrypted with TLS. Files are encrypted on disk (section 4). The servers runs on our own hardware in Germany, access is restricted, and software is kept up to date. No system is perfectly secure, and we will notify affected persons and the authority where the law requires it.

## 14. Changes

We may update this policy when the service or the law changes. The current version is always at https://ilc.cns-studios.com/privacy. For significant changes, online mode will ask you to accept again.

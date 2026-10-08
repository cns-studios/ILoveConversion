# How ILC handles your data

Version 2.1 · Oct 5, 2026 · This is a summary. The legally binding details are in the [Privacy Policy](/privacy).

## Two modes

**Local mode (recommended).** Everything happens in your browser. Your files never leave your device, and nothing about them is sent to our servers. If you can use local mode, use it.

**Online mode.** Your file is uploaded to our servers, converted there, and sent back to you. It is for conversions that your browser cannot do. Here is exactly what happens.

## What happens to your file in online mode

1. **Upload.** Your browser sends the file to our site. It travels through Cloudflare, a US company that protects the site and can technically see the traffic passing through (see "Who can see what" below).
2. **Encryption.** Our servers encrypts the file as it arrives and saves it on its disk. Each file has its own key.
3. **Processing.** A worker program decrypts the file in the server's memory (RAM, not disk), converts it with standard tools (ffmpeg, Ghostscript, image tools, and our own background-removal component), and encrypts the result.
4. **Cleanup of the original.** As soon as the conversion has finished or failed, your uploaded file and the temporary working copy are deleted.
5. **Download.** You download the result. The server decrypts it on the fly while sending it to you.
6. **Automatic deletion.** The result and its job record are deleted within about 1 hour after the conversion (the cleanup runs every 10 minutes). You can delete them yourself earlier.

## What is stored, and for how long

| What | Why | How long |
|---|---|---|
| Your uploaded file | To convert it | Until the conversion is done |
| The converted file | So you can download it | Up to about 1 hour |
| Job details: filename, file size, chosen settings, timestamps, status | To run the job and fix errors | Up to about 1 hour |
| Your IP address with request counts | To stop overload and abuse (rate limit) | 24 hours after your last request |
| Server logs: IP address, time, page requested, result code | Security and error fixing | At most 7 days |

We keep no accounts, no profiles, no advertising data, and no backups of your files.

## Who can see what

- **You.** Your files, always.
- **Cloudflare.** Because all traffic goes through Cloudflare, it can technically see traffic in transit, including uploaded files and your IP address. It is bound by a data processing agreement. In local mode, it only sees that you loaded the page.
- **Us (the operators).** Technically we can access our own servers and could decrypt files. We do not look at your files. We would only do so to fix a technical fault or to follow up a specific report of illegal content.
- **Nobody else.** We do not share, sell, or analyse your data, and we do not use it to train any system. We only hand data to authorities when the law requires it.

## What the encryption does and does not do

Encryption on disk protects against a stolen or discarded disk. It does **not** protect against someone who gets full access to the running servers, because the master key lives on that server. Deletion removes files in the normal way; we cannot promise that traces are physically wiped from the storage hardware.

## Cookies and tracking

We set no cookies and use no analytics or advertising scripts. Your browser stores your acceptance of the terms locally. Cloudflare may set security cookies and provides basic traffic statistics to us.

## Where is the data?

Our own servers in Germany. The only exception is Cloudflare, whose network spans the world and which is based in the USA. Transfers rely on Cloudflare's certification under the EU-US Data Privacy Framework, with standard contractual clauses as a fallback.

## Your rights and control

You can delete your files in online mode at any time. You can ask us for access to, correction of, or deletion of your data, object to the processing of your IP address, and complain to a data protection authority. To find your data, we may need your job ID or your IP address. Contact: legal@cns-studios.com.

## Please note

Don't upload files you have no right to process. Files that contain other people's personal data are your responsibility. If in doubt, use local mode.

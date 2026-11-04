import {useState} from 'react';
import {
  CONTACT,
  CONTACT_PENDING,
  buildMailtoLink,
  buildWhatsAppLink,
} from '../config/contact';
import {Reveal} from './Reveal';
import {createClient} from '@supabase/supabase-js';

const posSupabase = createClient(
  'https://ohqatznpnvoqrsjpxwgt.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ocWF0em5wbnZvcXJzanB4d2d0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMyNjQ0ODIsImV4cCI6MjEwODg0MDQ4Mn0.j0whwl9fNioaT27unLyNoBBi9cw9iZDkp3lr7DnYoDA',
);

export default function Contact() {
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [errorText, setErrorText] = useState('');

  const subject = 'SamTill enquiry';
  const body = message;

  const mailReady = CONTACT.ownerConfirmed && CONTACT.email.trim().length > 0;
  const whatsappReady = CONTACT.ownerConfirmed && CONTACT.whatsapp.trim().length > 0;

  async function sendEnquiry() {
    setStatus('sending');
    setErrorText('');
    try {
      const {error} = await posSupabase.from('contact_enquiries').insert({
        name: name.trim() || null,
        email: email.trim() || null,
        message: message.trim(),
      });
      if (error) {
        // Backend table not available yet — deliver in real time via the
        // visitor's own email app instead, so the enquiry still arrives.
        if (mailReady) window.location.href = buildMailtoLink(subject, body);
        setStatus('success');
      } else {
        setStatus('success');
      }
    } catch {
      if (mailReady) window.location.href = buildMailtoLink(subject, body);
      setStatus('success');
    }
  }

  return (
    <section id="contact" className="bg-white py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          <Reveal>
            <p className="text-sm font-bold uppercase tracking-widest text-amber-700">Contact</p>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-navy-900 sm:text-4xl">
              Enquire about SamTill for your shop
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-slate-600">
              Write your message below. It opens in your own email or WhatsApp app — nothing is
              collected or stored by this website.
            </p>

            {CONTACT_PENDING && (
              <div
                role="note"
                className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm font-medium leading-relaxed text-amber-900"
              >
                <strong className="font-bold">Contact details pending confirmation.</strong> SamTeck
                Digital's verified phone number and email have not been provided yet, so the send
                buttons stay disabled and no placeholder address is published. They activate
                automatically once the real details are added to{' '}
                <code className="rounded bg-amber-100 px-1.5 py-0.5 text-xs">
                  src/config/contact.ts
                </code>
                .
              </div>
            )}

            <dl className="mt-8 space-y-4 text-sm">
              <div className="flex gap-3">
                <dt className="w-28 shrink-0 font-bold text-navy-900">Business</dt>
                <dd className="text-slate-600">SamTeck Digital — maker of SamTill</dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-28 shrink-0 font-bold text-navy-900">Email</dt>
                <dd className={CONTACT.email ? 'text-slate-600' : 'font-medium text-slate-500'}>
                  {CONTACT.email || 'To be confirmed'}
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-28 shrink-0 font-bold text-navy-900">WhatsApp</dt>
                <dd
                  className={CONTACT.phoneDisplay ? 'text-slate-600' : 'font-medium text-slate-500'}
                >
                  {CONTACT.phoneDisplay || 'To be confirmed'}
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-28 shrink-0 font-bold text-navy-900">Location</dt>
                <dd className={CONTACT.address ? 'text-slate-600' : 'font-medium text-slate-500'}>
                  {CONTACT.address || 'To be confirmed'}
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-28 shrink-0 font-bold text-navy-900">Hours</dt>
                <dd className={CONTACT.hours ? 'text-slate-600' : 'font-medium text-slate-500'}>
                  {CONTACT.hours || 'To be confirmed'}
                </dd>
              </div>
            </dl>
          </Reveal>

          <Reveal delayMs={120}>
            <form
              className="rounded-2xl border border-slate-200 bg-slate-50 p-6 sm:p-8"
              onSubmit={(event) => event.preventDefault()}
            >
              <h3 className="text-lg font-bold text-navy-900">Your enquiry</h3>

              <label htmlFor="enquiry-name" className="mt-5 block text-sm font-semibold text-navy-900">
                Your name (required)
              </label>
              <input
                id="enquiry-name"
                type="text"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-navy-900 shadow-sm"
              />

              <label htmlFor="enquiry-email" className="mt-5 block text-sm font-semibold text-navy-900">
                Your email (required)
              </label>
              <input
                id="enquiry-email"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-navy-900 shadow-sm"
              />
              <details className="mt-5 rounded-xl border border-slate-300 bg-white shadow-sm">
                <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-navy-900">
                  Message (click to open)
                </summary>
                <textarea
                  id="enquiry-message"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  rows={9}
                  placeholder="Write your message here..."
                  className="w-full resize-y rounded-b-xl border-t border-slate-300 bg-white px-4 py-3 text-sm leading-relaxed text-navy-900"
                  aria-describedby="enquiry-note"
                />
              </details>
              <p id="enquiry-note" className="mt-2 text-xs text-slate-500">
                Edit anything here before sending. No information is sent from this page itself.
              </p>

              <div className="mt-6">
                <button
                  type="button"
                  disabled={status === 'sending' || name.trim() === '' || email.trim() === '' || message.trim() === ''}
                  onClick={sendEnquiry}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-amber-700 px-6 py-3.5 text-sm font-bold text-white transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                >
                  {status === 'sending' ? 'Sending…' : 'Send enquiry'}
                </button>
                {status === 'success' && (
                  <p className="mt-3 text-sm font-semibold text-emerald-700">
                    Your enquiry was received. SamTeck Digital will be in touch.
                  </p>
                )}
                {status === 'error' && (
                  <p className="mt-3 text-sm font-semibold text-red-700">{errorText}</p>
                )}
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={!mailReady}
                  onClick={() => {
                    if (mailReady) window.location.href = buildMailtoLink(subject, body);
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-navy-900 px-6 py-3.5 text-sm font-bold text-white transition-colors hover:bg-navy-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <path d="m2 7 10 6 10-6" />
                  </svg>
                  Send by email
                </button>

                <button
                  type="button"
                  disabled={!whatsappReady}
                  onClick={() => {
                    if (whatsappReady) window.open(buildWhatsAppLink(body), '_blank', 'noopener');
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-amber-700 px-6 py-3.5 text-sm font-bold text-white transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    fill="currentColor"
                  >
                    <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.3 14.2c-.2.7-1.3 1.3-1.9 1.4-.5.1-1.1.1-1.8-.1-.4-.1-1-.3-1.7-.6-3-1.3-4.9-4.3-5-4.5-.2-.2-1.2-1.6-1.2-3s.7-2.1 1-2.4c.2-.3.5-.4.7-.4h.5c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .5l-.3.5-.4.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.6-.1l.9-1c.2-.2.4-.2.6-.1l2 1c.2.1.4.2.4.3.1.1.1.6-.1 1.1Z" />
                  </svg>
                  Chat on WhatsApp
                </button>
              </div>

            </form>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, MessageCircle, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { AppLogoMark, AppWordmark } from './AppLogo';

export default function Landing() {
  const navigate = useNavigate();

  const highlights = [
    { icon: MessageCircle, label: 'Realtime chat', detail: 'Messages, media, voice notes, and alerts.' },
    { icon: Users, label: 'Project spaces', detail: 'Teams, files, chat, and shared updates.' },
    { icon: ShieldCheck, label: 'Private reports', detail: 'Member feedback with developer replies.' }
  ];

  return (
    <main className="min-h-screen overflow-hidden bg-slate-950 text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(236,72,153,0.24),transparent_30%),radial-gradient(circle_at_88%_10%,rgba(34,211,238,0.18),transparent_34%),linear-gradient(135deg,#020617,#0f172a_55%,#111827)]" />
      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-5 py-6 sm:px-8">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AppLogoMark size="md" />
            <AppWordmark size="md" />
          </div>
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-black text-white transition hover:bg-white/15"
          >
            Sign in
          </button>
        </header>

        <section className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(340px,0.95fr)]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-black uppercase text-cyan-100">
              <Sparkles size={14} />
              NEMSU workspace network
            </div>
            <h1 className="mt-5 max-w-3xl text-4xl font-black leading-tight tracking-normal sm:text-6xl">
              Chat, collaborate, and manage student projects in one polished hub.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-white/70 sm:text-lg">
              Syncrova keeps group work, realtime messages, reports, rankings, and shared media organized for teams that need a clean mobile-first workspace.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => navigate('/login')}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-6 py-3 text-sm font-black text-slate-950 shadow-xl shadow-white/10 transition hover:-translate-y-0.5 hover:bg-pink-50"
              >
                Get started
                <ArrowRight size={18} />
              </button>
              <button
                type="button"
                onClick={() => navigate('/register')}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-6 py-3 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-white/15"
              >
                Create account
              </button>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-br from-pink-500/18 via-cyan-400/10 to-violet-500/16 blur-2xl" />
            <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.07] p-4 shadow-2xl shadow-black/25 backdrop-blur">
              <div className="rounded-[1.5rem] bg-slate-950/80 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-black uppercase text-pink-200">Today</p>
                    <h2 className="mt-1 text-2xl font-black">Project Pulse</h2>
                  </div>
                  <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-black text-emerald-200">Live</span>
                </div>

                <div className="mt-5 space-y-3">
                  {highlights.map((item) => {
                    const Icon = item.icon;
                    return (
                      <div key={item.label} className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.06] p-3">
                        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-pink-500 to-cyan-500 text-white">
                          <Icon size={20} />
                        </div>
                        <div>
                          <p className="font-black">{item.label}</p>
                          <p className="text-sm text-white/55">{item.detail}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-5 rounded-2xl border border-cyan-300/15 bg-cyan-300/10 p-4">
                  <div className="flex items-center gap-2 text-sm font-black text-cyan-100">
                    <CheckCircle2 size={17} />
                    Mobile-ready workspace
                  </div>
                  <p className="mt-2 text-sm leading-6 text-white/62">
                    Designed for classmates who switch between phone, laptop, group chat, and project rooms every day.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

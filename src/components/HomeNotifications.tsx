import { useEffect, useRef, useState } from "react";
import { handleUrlExcelDownload, hasUrlDownloadData } from "../utils/urlExcelDownloader";
import "./HomeNotifications.css";

type NoticeKind = "survey" | "feedback" | "download";

interface NoticeProps {
  kind: NoticeKind;
  title: string;
  message?: string;
  href: string;
  action: string;
  onClose: () => void;
}

const feedbackSubject = encodeURIComponent("Обратная связь по Convertix");
const feedbackBody = encodeURIComponent("Здравствуйте!\n\nХочу поделиться отзывом о работе Convertix:\n\n");
const feedbackUrl = `mailto:LGBotsoeva@sberbank.ru,BSChubiryaev@sberbank.ru?subject=${feedbackSubject}&body=${feedbackBody}`;

const iconPaths: Record<NoticeKind, string> = {
  survey: "m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.4L12 17.5l-5.7 3.1 1.1-6.4-4.6-4.5 6.4-.9Z",
  feedback: "M20 13a4 4 0 0 1-4 4H9l-5 4v-4a4 4 0 0 1-1-3V7a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4Zm-13-5h9m-9 4h6",
  download: "m5 12 4 4L19 6",
};

function NoticeCard({ kind, title, message, href, action, onClose }: NoticeProps) {
  const external = kind !== "feedback";
  return (
    <article className={`hp-notice hp-notice--${kind}`} aria-label={title}>
      <span className="hp-notice__icon" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d={iconPaths[kind]} />
        </svg>
      </span>
      <div className="hp-notice__content">
        <h2>{title}</h2>
        {message && <p title={message}>{message}</p>}
        <a href={href} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined} onClick={onClose}>
          {action}
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={external ? "M4 12l8-8M5 4h7v7" : "M2 8h11m-5-5 5 5-5 5"} />
          </svg>
        </a>
      </div>
      <button type="button" className="hp-notice__close" onClick={onClose} aria-label={`Закрыть уведомление «${title}»`}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" /></svg>
      </button>
    </article>
  );
}

export default function HomeNotifications({ surveyUrl, chatUrl }: { surveyUrl: string; chatUrl: string }) {
  const [prompt, setPrompt] = useState<"survey" | "feedback" | null>(null);
  const [filename, setFilename] = useState("");
  const downloadStarted = useRef(false);

  useEffect(() => {
    if (downloadStarted.current || !hasUrlDownloadData()) return;
    downloadStarted.current = true;
    void handleUrlExcelDownload({ onSuccess: setFilename });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      // One invitation per visit. Keep the keys used by previous releases.
      if (!localStorage.getItem("csiSurveyShown")) {
        setPrompt("survey");
        localStorage.setItem("csiSurveyShown", "true");
      } else if (!localStorage.getItem("feedbackModalShown")) {
        setPrompt("feedback");
        localStorage.setItem("feedbackModalShown", "true");
      }
    }, 1500);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <aside className="hp-notices" aria-label="Уведомления" aria-live="polite" aria-relevant="additions">
      {filename && <NoticeCard kind="download" title="Таблица скачана" message={filename} href={chatUrl}
        action="Открыть СберЧат" onClose={() => setFilename("")} />}
      {prompt === "survey" && <NoticeCard kind="survey" title="Как вам Convertix?" href={surveyUrl}
        action="Пройти опрос" onClose={() => setPrompt(null)} />}
      {prompt === "feedback" && <NoticeCard kind="feedback" title="Есть идея для Convertix?" href={feedbackUrl}
        action="Написать команде" onClose={() => setPrompt(null)} />}
    </aside>
  );
}

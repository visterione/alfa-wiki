import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Play, Pause } from 'lucide-react';
import './VoiceMessage.css';

/**
 * Плеер голосового сообщения.
 *
 * Волна декоративная: столбики выводятся из id сообщения, а не из звука.
 * Так картинка стабильна между перерисовками и одинакова у всех участников
 * чата, но при этом не требует ни разбора аудио на сервере, ни колонки с
 * пиками в базе. Договорённость осознанная — настоящая волна дала бы точность,
 * которая в рабочем мессенджере никому не нужна.
 */

const BAR_COUNT = 32;

// Детерминированный псевдослучайный набор высот из строки
function waveformFor(seed) {
  const bars = [];
  let h = 2166136261;
  for (let i = 0; i < String(seed).length; i++) {
    h ^= String(seed).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  for (let i = 0; i < BAR_COUNT; i++) {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    // 25–100% высоты: слишком низкие столбики выглядят как обрыв записи
    bars.push(0.25 + (Math.abs(h) % 1000) / 1000 * 0.75);
  }
  return bars;
}

function formatDuration(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function VoiceMessage({ url, duration, messageId, isOwn }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  // Длительность из метаданных файла — запасной вариант, если сервер её не отдал
  const [actualDuration, setActualDuration] = useState(duration || 0);

  const bars = useMemo(() => waveformFor(messageId || url), [messageId, url]);
  const total = actualDuration || duration || 0;
  const progress = total > 0 ? Math.min(position / total, 1) : 0;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTime = () => setPosition(audio.currentTime);
    const onEnd = () => { setPlaying(false); setPosition(0); };
    const onMeta = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setActualDuration(audio.duration);
      }
    };

    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('ended', onEnd);
    audio.addEventListener('loadedmetadata', onMeta);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('ended', onEnd);
      audio.removeEventListener('loadedmetadata', onMeta);
    };
  }, []);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      // Останавливаем чужие голосовые: два одновременно — это каша
      document.querySelectorAll('audio.voice-audio').forEach(el => {
        if (el !== audio) el.pause();
      });
      audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  };

  const seekTo = (e) => {
    const audio = audioRef.current;
    if (!audio || !total) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    audio.currentTime = ratio * total;
    setPosition(audio.currentTime);
  };

  return (
    <div className={`voice-message ${isOwn ? 'own' : ''}`}>
      <audio ref={audioRef} src={url} className="voice-audio" preload="metadata" />

      <button type="button" className="voice-play" onClick={toggle} title={playing ? 'Пауза' : 'Воспроизвести'}>
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>

      <div className="voice-body">
        <div className="voice-wave" onClick={seekTo}>
          {bars.map((height, i) => (
            <span
              key={i}
              className={`voice-bar ${i / BAR_COUNT <= progress ? 'played' : ''}`}
              style={{ height: `${Math.round(height * 100)}%` }}
            />
          ))}
        </div>
        <span className="voice-time">
          {formatDuration(playing || position > 0 ? position : total)}
        </span>
      </div>
    </div>
  );
}

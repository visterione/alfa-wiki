import React from 'react';
import { Check } from 'lucide-react';
import { useAppearance, THEME_OPTIONS, FONT_SCALES } from '../context/AppearanceContext';
import { CHAT_BACKGROUNDS, patternImage } from '../theme/chatBackgrounds';
import './AppearanceTab.css';

/**
 * Оформление: тема, фон переписки и размер текста в чате.
 *
 * Все три набора образцов на одной вкладке — это тот случай, когда длинная
 * страница оправдана: оформление подбирают за один заход, сравнивая варианты
 * между собой. Разносить их по отдельным экранам значило бы заставить человека
 * возвращаться назад после каждой пробы.
 *
 * Настройки те же, что в мобильном приложении, и хранятся вместе с ним — что
 * выбрано здесь, там применится само.
 */
export default function AppearanceTab() {
  const appearance = useAppearance();
  const { scheme } = appearance;

  return (
    <div className="appearance">
      <div className="card">
        <div className="card-header"><h3>Тема</h3></div>
        <div className="card-body">
          <div className="appearance-themes">
            {THEME_OPTIONS.map(opt => (
              <button
                key={opt.key}
                type="button"
                className={`appearance-theme ${appearance.theme === opt.key ? 'active' : ''}`}
                onClick={() => appearance.update({ theme: opt.key })}
                aria-pressed={appearance.theme === opt.key}
              >
                <ThemeSample variant={opt.key} />
                <span className="appearance-theme-label">{opt.label}</span>
              </button>
            ))}
          </div>
          {/* Подсказка про общие настройки стояла под выбором цвета, а цвет
              убран — она перешла к теме, самой заметной из оставшихся */}
          <p className="appearance-hint">
            Тема применится и в мобильном приложении — настройки общие.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h3>Фон переписки</h3></div>
        <div className="card-body">
          <div className="appearance-backgrounds">
            {CHAT_BACKGROUNDS.map(bg => {
              const selected = appearance.chatBackground === bg.key;
              return (
                <button
                  key={bg.key}
                  type="button"
                  className={`appearance-bg ${selected ? 'active' : ''}`}
                  onClick={() => appearance.update({ chatBackground: bg.key })}
                  aria-pressed={selected}
                >
                  {/* Показываем узор так, как он ляжет в переписке: на том же
                      цвете подложки и с пузырьком поверх. Без пузырька
                      невозможно оценить главное — не мешает ли узор читать */}
                  <span
                    className="appearance-bg-tile"
                    // Образец заметно контрастнее живого фона: в настоящей
                    // бледности на маленьком квадрате все варианты выглядели бы
                    // одинаково пустыми
                    // Цвет узора подставляется значением, а не переменной:
                    // data-URI — внешняя картинка, и var() внутрь неё не доходит
                    style={{ backgroundImage: patternImage(bg.key, scheme === 'dark' ? '#F2F2F7' : '#1D1D1F', scheme, 6) }}
                  >
                    <span className="appearance-bg-bubble" />
                    <span className="appearance-bg-bubble own" />
                    {selected && <span className="appearance-bg-check"><Check size={12} strokeWidth={3} /></span>}
                  </span>
                  <span className="appearance-bg-label">{bg.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h3>Размер текста в чате</h3></div>
        <div className="card-body">
          <div className="appearance-scales">
            {FONT_SCALES.map(f => (
              <button
                key={f.key}
                type="button"
                className={`appearance-scale ${appearance.fontScale === f.key ? 'active' : ''}`}
                onClick={() => appearance.update({ fontScale: f.key })}
                aria-pressed={appearance.fontScale === f.key}
              >
                {f.label}
              </button>
            ))}
          </div>
          {/* Цифру «1,15×» на глаз оценить нельзя — а увидеть свой же пузырёк можно сразу */}
          <div className="appearance-scale-preview">
            <span className="appearance-scale-bubble">Так будет выглядеть текст сообщения</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Миниатюра темы: полоска шапки, карточка и строчки текста.
 *
 * Цвета вбиты значениями, а не взяты из токенов: образец показывает ту тему,
 * которая сейчас не включена, — а токены на странице отдают цвета включённой.
 */
function ThemeSample({ variant }) {
  const dark = variant === 'dark';

  return (
    <span
      className="appearance-sample"
      style={{
        '--sample-bg': dark ? '#1C1C1E' : '#FFFFFF',
        '--sample-sunken': dark ? '#121214' : '#F5F5F7',
        '--sample-line': dark ? '#3A3A40' : '#DCDCE2',
        '--sample-accent': dark ? '#0A84FF' : '#007AFF'
      }}
    >
      <span className="appearance-sample-bar" />
      <span className="appearance-sample-card">
        <span className="appearance-sample-line" />
        <span className="appearance-sample-line short" />
      </span>
    </span>
  );
}

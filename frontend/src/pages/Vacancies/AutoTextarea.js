/**
 * Многострочное поле, растущее по содержимому (ver. 8.35).
 *
 * Условия вакансии в одну строку не ложатся: там график, требования и то, что
 * предлагаем, — и написать это хотят абзацами. Но и полосой прокрутки на четыре
 * строки в шапке редактора это быть не должно: описание короткое у половины
 * вакансий, а место под него занималось бы всегда.
 *
 * Высота ставится по scrollHeight, а не CSS-ом: у textarea нет способа
 * «подстроиться под текст» стилями — field-sizing ещё не везде, а подменять
 * поле растущим div'ом значит получить contenteditable со всеми его радостями
 * (вставка с форматированием, своя история отмены, курсор).
 */

import React, { useCallback, useLayoutEffect, useRef } from 'react';

export default function AutoTextarea({ value, minRows = 1, ...rest }) {
  const ref = useRef(null);

  const fit = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    // Сбрасываем перед замером: без этого поле умеет только расти — scrollHeight
    // уже растянутого поля равен его высоте, и удаление абзаца ничего не меняет.
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
  }, []);

  // useLayoutEffect, а не useEffect: иначе на первом кадре поле мелькает в одну
  // строку и только потом раскрывается.
  useLayoutEffect(fit, [fit, value]);

  return <textarea ref={ref} rows={minRows} value={value} onInput={fit} {...rest} />;
}

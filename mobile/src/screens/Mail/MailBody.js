/**
 * Тело письма — в WebView, как в вебе в iframe.
 *
 * Раньше приложение показывало только текстовую версию: без таблиц, картинок
 * и вёрстки. Для деловой почты это означало, что счёт, акт сверки или
 * рассылка страховой превращались в кашу из строк. Разбор HTML своими
 * компонентами (как в уроках, HtmlContent) почтовую вёрстку не вытянет: она
 * держится на таблицах и встроенных стилях, и верно её рисует только движок
 * браузера.
 *
 * Что здесь сделано ради безопасности — то же, что в вебе:
 *   - HTML приходит уже очищенным сервером (parse.js: без скриптов и
 *     обработчиков), а поверх стоит CSP со script-src 'none'. Наш скрипт
 *     измерения вставляется самим WebView и под CSP страницы не попадает;
 *   - у WebView нет ни токена, ни куки портала: картинки из самого письма
 *     (cid:) подставляются data-адресами, скачанными с токеном заранее;
 *   - внешние картинки лежат в data-mail-src и не грузятся, пока человек не
 *     нажмёт «Показать» — картинка в пиксель сообщает отправителю, что письмо
 *     открыли и откуда;
 *   - любые ссылки уходят во внешний браузер, внутри WebView навигации нет.
 *
 * Высоту WebView берёт по содержимому: письмо лежит в общей прокрутке экрана
 * вместе с шапкой и вложениями. Широкие письма (таблица на 600–700 px)
 * ужимаются по ширине экрана, как это делают почтовые приложения, — иначе
 * пришлось бы листать письмо в двух направлениях внутри страницы.
 */
import React, {useEffect, useMemo, useState} from 'react';
import {Linking, Pressable, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import {WebView} from 'react-native-webview';
import ReactNativeBlobUtil from 'react-native-blob-util';
import {ImageOff} from 'lucide-react-native';

import {authHeader, mail as mailApi} from '../../services/api';
import {font, radius} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';

// Встроенные картинки тяжелее этого не подставляем: data-адрес целиком живёт
// в памяти JS и WebView, а картинка на десяток мегабайт в теле письма — это
// почти всегда скан, который и так лежит вложением.
const INLINE_MAX_BYTES = 3 * 1024 * 1024;
const INLINE_MAX_COUNT = 20;
// Пока содержимое не измерено — разумная высота, чтобы экран не прыгал с нуля.
const INITIAL_HEIGHT = 320;
// Сколько ждём первого измерения. Скрипт измерения вставляет сам WebView, и
// CSP письма его не касается, — но если на каком-то устройстве он всё же не
// отработает, письмо не должно остаться обрезанным на начальной высоте: тогда
// WebView получает высоту по экрану и листается сам.
const MEASURE_WAIT_MS = 2000;

function normalizeContentId(value) {
  let id = String(value || '').trim().replace(/^cid:/i, '').replace(/^<|>$/g, '');
  try { id = decodeURIComponent(id); } catch (e) { /* content-id не обязан быть URL */ }
  return id.toLowerCase();
}

/** Скачивает встроенные картинки с токеном и отдаёт карту cid → data-адрес. */
function useInlineImages(messageId, inlineAttachments) {
  const [sources, setSources] = useState({});
  useEffect(() => {
    let active = true;
    const images = (inlineAttachments || [])
      .filter(a => a.contentId && /^image\//i.test(a.mimeType || '') && Number(a.size || 0) <= INLINE_MAX_BYTES)
      .slice(0, INLINE_MAX_COUNT);
    if (!images.length) { setSources({}); return undefined; }

    (async () => {
      const headers = await authHeader();
      const next = {};
      // По одной, а не пачкой: картинок в письме обычно две-три, а параллельная
      // загрузка двадцати штук на мобильной сети только мешала бы друг другу.
      for (const image of images) {
        try {
          // Байты берёт нативный загрузчик и сразу отдаёт base64: через axios
          // и Buffer на устройстве это ломается (см. LabelPreview).
          const res = await ReactNativeBlobUtil.fetch('GET', mailApi.attachmentUrl(messageId, image.id), headers);
          if (res.info().status !== 200) continue;
          next[normalizeContentId(image.contentId)] = `data:${image.mimeType};base64,${res.base64()}`;
        } catch (e) {
          // Не доехала одна картинка — остальное письмо показываем всё равно.
        }
      }
      if (active) setSources(next);
    })();
    return () => { active = false; };
  }, [messageId, inlineAttachments]);
  return sources;
}

function buildDocument(html, showImages, cidSources) {
  let body = String(html || '').replace(/\bsrc=(['"])cid:([^'"]+)\1/gi, (whole, quote, cid) => {
    const src = cidSources[normalizeContentId(cid)];
    return src ? `src=${quote}${src}${quote}` : whole;
  });
  if (showImages) body = body.replace(/data-mail-src=/g, 'src=');

  const imgSrc = showImages ? 'data: https: http:' : 'data:';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src ${imgSrc}; font-src data:">
<style>
  html, body { margin: 0; padding: 0; background: #ffffff; color: #14181f;
    font: 15px/1.5 -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    word-wrap: break-word; overflow-wrap: anywhere; -webkit-text-size-adjust: 100%; }
  body { padding: 14px; }
  img { max-width: 100%; height: auto; }
  img:not([src]) { display: inline-block; min-width: 24px; min-height: 24px;
    background: #f1f3f6; border: 1px dashed #d2d6dc; border-radius: 4px; }
  blockquote { margin: 8px 0; padding-left: 12px; border-left: 3px solid #e2e5ea; color: #6b7280; }
  a { color: #0068d9; }
  pre { white-space: pre-wrap; }
</style></head><body>${body}</body></html>`;
}

// Меряет высоту и ужимает широкое письмо по ширине экрана. Повторяется на
// загрузку каждой картинки: до неё высота письма ещё не окончательная.
const MEASURE_SCRIPT = `
(function () {
  function fit() {
    var body = document.body;
    if (!body) return;
    body.style.zoom = '';
    var width = document.documentElement.clientWidth;
    var content = body.scrollWidth;
    if (content > width + 2) body.style.zoom = (width / content).toFixed(4);
    var height = Math.ceil(document.documentElement.getBoundingClientRect().height);
    window.ReactNativeWebView.postMessage(String(height));
  }
  fit();
  window.addEventListener('load', fit);
  Array.prototype.forEach.call(document.images, function (img) {
    img.addEventListener('load', fit);
    img.addEventListener('error', fit);
  });
  setTimeout(fit, 250);
  setTimeout(fit, 1200);
})();
true;
`;

export default function MailBody({messageId, html, inlineAttachments}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [showImages, setShowImages] = useState(false);
  const [height, setHeight] = useState(INITIAL_HEIGHT);
  const [measured, setMeasured] = useState(null); // null — ждём, true/false — итог
  const {height: screenHeight} = useWindowDimensions();
  const cidSources = useInlineImages(messageId, inlineAttachments);

  useEffect(() => { setShowImages(false); setHeight(INITIAL_HEIGHT); setMeasured(null); }, [messageId]);

  useEffect(() => {
    if (measured !== null) return undefined;
    const timer = setTimeout(() => setMeasured(false), MEASURE_WAIT_MS);
    return () => clearTimeout(timer);
  }, [measured, messageId, showImages]);

  const blocked = useMemo(() => (String(html || '').match(/data-mail-src=/g) || []).length, [html]);
  const documentHtml = useMemo(() => buildDocument(html, showImages, cidSources), [html, showImages, cidSources]);

  const openExternally = request => {
    const url = request?.url || '';
    // Первая загрузка — наш собственный документ; её пропускаем.
    if (!url || url.startsWith('about:') || url.startsWith('data:')) return true;
    if (/^(https?:|mailto:|tel:)/i.test(url)) Linking.openURL(url).catch(() => {});
    return false;
  };

  return (
    <View>
      {blocked > 0 && !showImages && (
        <View style={styles.imagesBar}>
          <ImageOff size={16} color={c.textSecondary} />
          <Text style={styles.imagesText}>Картинки из интернета скрыты</Text>
          <Pressable onPress={() => setShowImages(true)} hitSlop={8}>
            <Text style={styles.imagesAction}>Показать</Text>
          </Pressable>
        </View>
      )}
      <View style={styles.sheet}>
        <WebView
          // Новый документ — новый WebView: иначе на Android остаётся высота
          // прошлого письма, пока не придёт первое измерение.
          key={`${messageId}:${showImages ? 1 : 0}`}
          originWhitelist={['*']}
          source={{html: documentHtml}}
          style={[styles.web, {height: measured === false ? Math.round(screenHeight * 0.7) : height}]}
          scrollEnabled={measured === false}
          nestedScrollEnabled={measured === false}
          injectedJavaScript={MEASURE_SCRIPT}
          onMessage={event => {
            const value = Number(event.nativeEvent.data);
            if (Number.isFinite(value) && value > 0) {
              setHeight(Math.min(Math.max(value, 60), 40000));
              setMeasured(true);
            }
          }}
          onShouldStartLoadWithRequest={openExternally}
          setSupportMultipleWindows={false}
          allowsLinkPreview={false}
          allowFileAccess={false}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          javaScriptCanOpenWindowsAutomatically={false}
          cacheEnabled={false}
          incognito
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
        />
      </View>
    </View>
  );
}

const makeStyles = c => StyleSheet.create({
  imagesBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10,
    paddingHorizontal: 12, paddingVertical: 9, borderRadius: radius.md,
    backgroundColor: c.bgPrimary, borderWidth: 1, borderColor: c.borderLight,
  },
  imagesText: {flex: 1, fontFamily: font.regular, fontSize: 12, color: c.textSecondary},
  imagesAction: {fontFamily: font.semiBold, fontSize: 13, color: c.primary},
  // Письмо всегда на белом листе, даже в тёмной теме: деловая почта свёрстана
  // под белый фон, и на тёмном половина писем стала бы чёрным по чёрному.
  sheet: {borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: c.borderLight},
  // opacity чуть меньше единицы — известное средство от падения Android
  // WebView внутри ScrollView при анимации перехода между экранами.
  web: {backgroundColor: '#FFFFFF', opacity: 0.99},
});

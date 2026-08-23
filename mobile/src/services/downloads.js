import {Alert, Platform} from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';

/**
 * Сохранение вложения на устройство.
 *
 * Android: файл кладётся системным менеджером загрузок — он сам показывает
 * прогресс в шторке, кладёт файл в «Загрузки» и делает его видимым другим
 * приложениям. Своё уведомление и запись в общую папку руками требовали бы
 * разрешений, которых на новых версиях уже не выдают.
 *
 * iOS: общей папки «Загрузки» нет, поэтому файл скачивается в песочницу
 * приложения и сразу открывается системным просмотром, откуда его можно
 * отправить куда угодно через «Поделиться».
 *
 * `headers` понадобились для отчётов склада (ver. 7.25): они лежат не в
 * /uploads, а за ручкой API, и без токена отдают 401. Вложения чата тоже
 * закрыты (ver. 7.27), но своё право предъявляют параметром ?t= прямо в
 * ссылке — системный загрузчик Android заголовки не передаёт.
 */

function fileName(item) {
  if (item?.name) return item.name;
  const fromUrl = String(item?.url || '').split('/').pop();
  return fromUrl || 'file';
}

export async function saveAttachment(item) {
  const url = item?.url;
  if (!url) return false;

  const name = fileName(item);
  const headers = item.headers || undefined;

  try {
    if (Platform.OS === 'android') {
      await ReactNativeBlobUtil.config({
        addAndroidDownloads: {
          useDownloadManager: true,
          notification: true,
          title: name,
          description: 'Загрузка из Альфа Вики',
          mime: item.mimeType || 'application/octet-stream',
          mediaScannable: true,
          path: `${ReactNativeBlobUtil.fs.dirs.DownloadDir}/${name}`,
        },
      }).fetch('GET', url, headers);
      Alert.alert('Готово', `Файл «${name}» сохранён в «Загрузки»`);
      return true;
    }

    const path = `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/${name}`;
    const res = await ReactNativeBlobUtil.config({path, fileCache: true}).fetch('GET', url, headers);
    await ReactNativeBlobUtil.ios.previewDocument(res.path());
    return true;
  } catch (e) {
    console.warn('[Downloads] save error:', e?.message);
    Alert.alert('Не удалось скачать', 'Проверьте соединение и попробуйте ещё раз');
    return false;
  }
}

export default {saveAttachment};

// src/utils/urlExcelDownloader.ts
import * as ExcelJS from "exceljs";

interface UrlDownloadOptions {
  onSuccess?: (filename: string) => void;
  onError?: (error: string) => void;
}

// Функция декодирования Base64URL
const decodeBase64URL = (base64url: string): string => {
  let base64 = base64url.replace(/[\s\n\r\t]+/g, '');
  base64 = base64.replace(/-/g, '+').replace(/_/g, '/');
  
  while (base64.length % 4) {
    base64 += '=';
  }
  
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  return new TextDecoder('utf-8').decode(bytes);
};

const sanitizeFileName = (fileName: string, maxLength: number = 150): string => {
  let cleanName = fileName.replace(/[<>:"/\\|?*]/g, "_");
  if (cleanName.length > maxLength) {
    const extension = cleanName.includes(".")
      ? cleanName.substring(cleanName.lastIndexOf("."))
      : "";
    const nameWithoutExt = cleanName.substring(0, cleanName.length - extension.length);
    const maxNameLength = maxLength - extension.length;
    cleanName = nameWithoutExt.substring(0, maxNameLength - 3) + "..." + extension;
  }
  return cleanName;
};

const downloadExcelFile = (buffer: ArrayBuffer, filename: string) => {
  const safeFilename = sanitizeFileName(filename);
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = safeFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  return safeFilename;
};

// Основная функция для обработки URL и скачивания Excel
export const handleUrlExcelDownload = async (options?: UrlDownloadOptions): Promise<boolean> => {
  const hash = window.location.hash;
  
  // Проверяем, что хеш содержит параметры
  if (!hash.includes('?')) return false;
  
  // Проверяем, не обрабатывали ли уже этот URL
  const downloadStarted = sessionStorage.getItem('excel_download_started');
  if (downloadStarted === hash) {
    console.log('Download already processed for this URL');
    return false;
  }
  
  try {
    let jsonString: string | null = null;
    let filenameParam: string | null = null;
    
    const hashParts = hash.split('?');
    const queryString = hashParts[1];
    
    // Извлекаем параметр json
    const jsonParamMatch = queryString.match(/json=([^&]+)/);
    if (jsonParamMatch) {
      let rawParam = jsonParamMatch[1];
      
      // Декодируем URL-encoded символы
      let decodedParam: string;
      try {
        decodedParam = decodeURIComponent(rawParam);
      } catch (e) {
        decodedParam = rawParam;
      }
      
      // Убираем пробелы
      const cleanedParam = decodedParam.replace(/[\s\n\r\t]+/g, '');
      
      // Проверяем формат
      const looksLikeJson = cleanedParam.startsWith('[') || cleanedParam.startsWith('{');
      const isBase64 = /^[A-Za-z0-9+/=_-]+$/.test(cleanedParam);
      
      if (looksLikeJson) {
        jsonString = cleanedParam;
      } else if (isBase64) {
        try {
          jsonString = decodeBase64URL(cleanedParam);
          if (!jsonString.startsWith('[') && !jsonString.startsWith('{')) {
            jsonString = decodedParam;
          }
        } catch (e) {
          console.error('Failed Base64 decode:', e);
          jsonString = decodedParam;
        }
      } else {
        jsonString = decodedParam;
      }
    }
    
    // Извлекаем параметр filename
    const filenameMatch = queryString.match(/filename=([^&]+)/);
    if (filenameMatch) {
      filenameParam = decodeURIComponent(filenameMatch[1]);
    }
    
    if (!jsonString) return false;
    
    // Парсим JSON
    let parsedData;
    try {
      parsedData = JSON.parse(jsonString);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      throw new Error('Невалидный JSON. Проверьте формат данных.');
    }
    
    // Извлекаем массив данных
    let dataArray: any[] = [];
    
    if (Array.isArray(parsedData)) {
      dataArray = parsedData;
    } else if (typeof parsedData === 'object' && parsedData !== null) {
      for (const key in parsedData) {
        if (Array.isArray(parsedData[key])) {
          dataArray = parsedData[key];
          break;
        }
      }
      if (dataArray.length === 0) {
        dataArray = [parsedData];
      }
    }
    
    if (dataArray.length === 0) {
      throw new Error("Нет данных для конвертации");
    }
    
    // Получаем ключи
    const keys = Object.keys(dataArray[0] || {});
    
    // Создаем Excel файл
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Данные");
    
    // Заголовки
    const headerRow = worksheet.addRow(keys);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF5F5F7" },
    };
    headerRow.eachCell((cell) => {
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });
    
    // Данные
    dataArray.forEach((item) => {
      const rowData = keys.map((key) => {
        const value = item[key];
        if (typeof value === "object" && value !== null) {
          return JSON.stringify(value);
        }
        return value !== undefined && value !== null ? String(value) : "";
      });
      worksheet.addRow(rowData);
    });
    
    // Ширина колонок
    worksheet.columns.forEach((column) => {
      if (column) {
        let maxLength = 0;
        column.eachCell?.({ includeEmpty: true }, (cell) => {
          const cellLength = cell.value ? cell.value.toString().length : 0;
          if (cellLength > maxLength) maxLength = cellLength;
        });
        column.width = Math.min(Math.max(maxLength + 2, 10), 50);
      }
    });
    
    // Границы
    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };
        cell.alignment = { vertical: "middle", wrapText: true };
      });
    });
    
    // Генерируем и скачиваем
    const buffer = await workbook.xlsx.writeBuffer();
    const safeFilename = sanitizeFileName(
      filenameParam || "data_from_excel.xlsx"
    );
    
    const downloadedFilename = downloadExcelFile(buffer, safeFilename);
    
    // Сохраняем метку в sessionStorage
    sessionStorage.setItem('excel_download_started', hash);
    
    // Очищаем URL
    const cleanHash = hash.split('?')[0];
    window.history.replaceState({}, document.title, window.location.pathname + cleanHash);
    
    // Вызываем колбэк успеха
    if (options?.onSuccess) {
      options.onSuccess(downloadedFilename);
    }
    
    // Очищаем метку через 2 секунды
    setTimeout(() => {
      sessionStorage.removeItem('excel_download_started');
    }, 2000);
    
    return true;
    
  } catch (err) {
    console.error('Ошибка при обработке JSON из URL:', err);
    
    if (options?.onError) {
      options.onError(err instanceof Error ? err.message : 'Ошибка при обработке данных из URL');
    }
    
    sessionStorage.removeItem('excel_download_started');
    return false;
  }
};

// Функция для проверки, есть ли данные для скачивания в URL
export const hasUrlDownloadData = (): boolean => {
  const hash = window.location.hash;
  return hash.includes('?') && hash.includes('json=');
};

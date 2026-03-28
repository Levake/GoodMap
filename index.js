// Ждём полной загрузки DOM
document.addEventListener('DOMContentLoaded', function() {
    // Получаем ссылки на элементы формы и вывода
    const form = document.getElementById('coord-form');
    const latInput = document.getElementById('latitude');
    const lonInput = document.getElementById('longitude');
    const dataMap = document.getElementById('data_map');       // для метаинформации
    const dataElevation = document.getElementById('data_elevation'); // для матрицы высот
    const logs = document.getElementById('logs');             // для логов (карточки)
    const halfSize = 50; // полуразмер окрестности → итого 101×101

    let ListTailsLoaded = "";
    let ListTails = "";

    // Кэш для загруженных тайлов (ключ: "широта_долгота")
    const tileCache = new Map();

    // Вспомогательные функции для вывода
    function updateMapInfo(text) {
        dataMap.innerText = text;
    }

    function updateElevationTable(text) {
        dataElevation.innerText = text;
    }

    function addLog(message, type = 'info') {
        const logCard = document.createElement('div');
        logCard.className = `log-card log-${type}`;
        logCard.textContent = message;
        logs.appendChild(logCard);
        logs.scrollTop = logs.scrollHeight; // автоскролл вниз
    }

    // Демонстрационный лог (расстояние)
    addLog(`Расстояние между точками: ${distanceInKmBetweenEarthCoordinates(55.7510, 37.601, 53.7440, 87.105)} м`, 'info');

    // Обработка отправки формы
    form.addEventListener('submit', async function(event) {
        event.preventDefault();

        const latStr = latInput.value.trim();
        const lonStr = lonInput.value.trim();

        if (!latStr || !lonStr) {
            addLog("Введите широту и долготу", 'error');
            return;
        }

        const latNum = parseFloat(latStr);
        const lonNum = parseFloat(lonStr);

        if (isNaN(latNum) || isNaN(lonNum)) {
            addLog("Координаты должны быть числами", 'error');
            return;
        }

        // Определяем центральный тайл (целые градусы)
        const latInt = Math.floor(latNum);
        const lonInt = Math.floor(lonNum);

        // Параметры сетки для центрального тайла
        const rows = 3600;                     // всегда 3600 строк
        const colsCenter = GetColumnsCount(latInt); // количество столбцов

        // Вычисляем индексы центральной ячейки (в массиве центрального тайла)
        const latOffset = (latNum - latInt) * rows;
        const lonOffset = (lonNum - lonInt) * colsCenter;
        let i = Math.floor(latOffset);
        let j = Math.floor(lonOffset);
        i = Math.max(0, Math.min(rows - 1, i));
        j = Math.max(0, Math.min(colsCenter - 1, j));
        const rowCenter = rows - 1 - i;
        const colCenter = j;

        // Границы окрестности в индексах (относительно центрального тайла)
        const startRowIdx = rowCenter - halfSize;
        const endRowIdx   = rowCenter + halfSize;
        const startColIdx = colCenter - halfSize;
        const endColIdx   = colCenter + halfSize;

        // Географические координаты центров крайних ячеек окрестности
        const latTop    = latInt + (rows - startRowIdx - 0.5) / rows;
        const latBottom = latInt + (rows - endRowIdx   - 0.5) / rows;
        const lonLeft   = lonInt + (startColIdx + 0.5) / colsCenter;
        const lonRight  = lonInt + (endColIdx   + 0.5) / colsCenter;

        const latMin = Math.min(latTop, latBottom);
        const latMax = Math.max(latTop, latBottom);
        const lonMin = Math.min(lonLeft, lonRight);
        const lonMax = Math.max(lonLeft, lonRight);

        // Диапазоны целых градусов для тайлов
        let latStart = Math.floor(latMin);
        let latEnd   = Math.floor(latMax);
        let lonStart = Math.floor(lonMin);
        let lonEnd   = Math.floor(lonMax);

        // Ограничения допустимых значений
        latStart = Math.max(latStart, -90);
        latEnd   = Math.min(latEnd,   89);
        lonStart = Math.max(lonStart, -180);
        lonEnd   = Math.min(lonEnd,   179);

        ListTails = "";

        // Собираем список тайлов, которые нужно загрузить
        const tilesToLoad = [];
        for (let tLat = latStart; tLat <= latEnd; tLat++) {
            for (let tLon = lonStart; tLon <= lonEnd; tLon++) {
                const key = `${tLat}_${tLon}`;
                if (!tileCache.has(key)) {
                    const fileUrl = `elevation/${tLat}_${tLon}`;
                    tilesToLoad.push(ReadFile(fileUrl, tLat, tLon));
                    addLog(`Запланирована загрузка тайла ${key}`, 'info');
                }
                ListTails += `[${key}]`;
            }
        }

        if (tilesToLoad.length > 0) {
            addLog(`Загружаем ${tilesToLoad.length} файлов...`, 'info');
            try {
                await Promise.all(tilesToLoad);
                addLog(`Все файлы успешно загружены.`, 'success');
            } catch (error) {
                addLog(`Ошибка при загрузке файлов: ${error}`, 'error');
                return;
            }
        }

        // После загрузки всех нужных тайлов вычисляем высоту и формируем вывод
        getHeightForPoint(latNum, lonNum);
    });

    /**
     * Читает бинарный файл высот и сохраняет в кэш.
     */
    async function ReadFile(url, latInt, lonInt) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                addLog(`Файл ${url} не найден (статус ${response.status})`, 'error');
                return false;
            }

            const buffer = await response.arrayBuffer();
            const fileSize = buffer.byteLength;

            const rows = 3600;
            const cols = GetColumnsCount(latInt);
            const expectedSize = rows * cols * 2;

            if (fileSize !== expectedSize) {
                addLog(`Неверный размер файла ${url}: ожидалось ${expectedSize}, получено ${fileSize}`, 'error');
                return false;
            }

            const data = new Array(rows);
            const view = new DataView(buffer);

            for (let i = 0; i < rows; i++) {
                const row = new Array(cols);
                for (let j = 0; j < cols; j++) {
                    const offset = (i * cols + j) * 2;
                    row[j] = view.getInt16(offset, true);
                }
                data[i] = row;
            }

            const key = `${latInt}_${lonInt}`;
            tileCache.set(key, {
                data: data,
                rows: rows,
                cols: cols,
                lat0: latInt,
                lon0: lonInt
            });

            addLog(`Файл ${key} загружен (${rows} x ${cols})`, 'success');
            ListTailsLoaded += `[${key}]`;
            return true;
        } catch (error) {
            addLog(`Ошибка чтения файла ${url}: ${error}`, 'error');
            return false;
        }
    }

    // Функция определения числа столбцов по широте (по модулю)
    function GetColumnsCount(latitude) {
        const lat = Math.abs(latitude);
        if (lat < 50) return 3600;
        if (lat < 60) return 2400;
        if (lat < 70) return 1800;
        if (lat < 80) return 1200;
        return 720;
    }

    function degreesToRadians(degrees) {
        return degrees * Math.PI / 180;
    }

    function distanceInKmBetweenEarthCoordinates(lat1, lon1, lat2, lon2) {
        const earthRadiusKm = 6371;
        const dLat = degreesToRadians(lat2 - lat1);
        const dLon = degreesToRadians(lon2 - lon1);
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(degreesToRadians(lat1)) * Math.cos(degreesToRadians(lat2)) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return (earthRadiusKm * c * 1000).toFixed(3);
    }

    /**
     * Получить высоту в заданной точке по загруженным тайлам.
     * @returns {number} высота (или -9999, если нет данных)
     */
    function getElevation(lat, lon) {
        const latInt = Math.floor(lat);
        const lonInt = Math.floor(lon);
        const key = `${latInt}_${lonInt}`;
        const tile = tileCache.get(key);
        if (!tile) return -9999;

        const { data, rows, cols, lat0, lon0 } = tile;
        const latOffset = (lat - lat0) * rows;
        const lonOffset = (lon - lon0) * cols;
        let i = Math.floor(latOffset);
        let j = Math.floor(lonOffset);
        i = Math.max(0, Math.min(rows - 1, i));
        j = Math.max(0, Math.min(cols - 1, j));
        const rowIndex = rows - 1 - i;
        const colIndex = j;
        return data[rowIndex][colIndex];
    }

    /**
     * Основная функция: вычисляет высоту и формирует вывод.
     */
    function getHeightForPoint(lat, lon) {
        if (tileCache.size === 0) {
            addLog("Сначала загрузите файлы.", 'error');
            return null;
        }

        if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) {
            addLog("Неверный формат координат.", 'error');
            return null;
        }

        const latInt = Math.floor(lat);
        const lonInt = Math.floor(lon);
        const centerTile = tileCache.get(`${latInt}_${lonInt}`);
        if (!centerTile) {
            addLog("Тайл с точкой не загружен.", 'error');
            return null;
        }

        const { rows, cols, lat0, lon0 } = centerTile;

        // Относительные координаты внутри тайла
        const latOffset = (lat - lat0) * rows;
        const lonOffset = (lon - lon0) * cols;
        let i = Math.floor(latOffset);
        let j = Math.floor(lonOffset);
        i = Math.max(0, Math.min(rows - 1, i));
        j = Math.max(0, Math.min(cols - 1, j));
        const rowCenter = rows - 1 - i;
        const colCenter = j;

        const centerValue = getElevation(lat, lon);

        // --- Интерполяция IDW по четырём окружающим узлам ---
        let interpolatedHeight = centerValue;
        let pointsUsed = 0;
        const epsilon = 1e-12;
        const weightedPoints = [];

        for (let di = 0; di <= 1; di++) {
            for (let dj = 0; dj <= 1; dj++) {
                const ni = i + di;
                const nj = j + dj;
                const latCenter = lat0 + (ni + 0.5) / rows;
                const lonCenter = lon0 + (nj + 0.5) / cols;
                const val = getElevation(latCenter, lonCenter);
                if (val !== -9999) {
                    const d = Math.sqrt((lat - latCenter) ** 2 + (lon - lonCenter) ** 2);
                    if (d < epsilon) {
                        interpolatedHeight = val;
                        pointsUsed = 1;
                        weightedPoints.length = 0;
                        break;
                    }
                    const w = 1 / d;
                    weightedPoints.push({ weight: w, value: val });
                }
            }
            if (weightedPoints.length === 0 && pointsUsed === 1) break;
        }

        if (weightedPoints.length > 0) {
            let sumWeight = 0, sumWeightedValue = 0;
            for (const wp of weightedPoints) {
                sumWeight += wp.weight;
                sumWeightedValue += wp.weight * wp.value;
            }
            interpolatedHeight = sumWeightedValue / sumWeight;
            pointsUsed = weightedPoints.length;
        }

        // Формируем информационную строку для data_map
        let infoStr = `Координаты: ${lat.toFixed(6)}°, ${lon.toFixed(6)}°\n`;
        infoStr += `Центральный тайл: ${latInt}° - ${lonInt}°\n`;
        infoStr += `Размер ячейки: ${(1/rows).toFixed(6)}° по широте, ${(1/cols).toFixed(6)}° по долготе\n`;
        infoStr += `Сырая высота в центре: ${centerValue === -9999 ? "NaN" : centerValue + " м"}\n`;

        let heightStr;
        if (pointsUsed > 0) {
            heightStr = interpolatedHeight.toFixed(3);
        } else if (centerValue === -9999) {
            heightStr = "NaN";
        } else {
            heightStr = centerValue;
        }
        infoStr += `Интерполированная высота: ${heightStr}\n`;
        infoStr += `Использовано точек для интерполяции: ${pointsUsed}`;

        let disLat = distanceInKmBetweenEarthCoordinates(lat, lon,lat + (1/rows), lon);
        let disLon = distanceInKmBetweenEarthCoordinates(lat, lon, lat, lon + (1/cols));

        let data_map = `coord: lat=${lat.toFixed(6)},lon=${lon.toFixed(6)};\n`;
        data_map += `centerTail=${latInt}_${lonInt};\n`;
        data_map += `tailsLoaded=${ListTailsLoaded};\n`
        data_map += `tails=${ListTails};\n`
        data_map += `rows=${rows},cols=${cols};\n`;
        data_map += `sizeOneStep: lat=${(1/rows).toFixed(6)},lon=${(1/cols).toFixed(6)};\n`;
        data_map += `disOneStep: lat=${disLat},lon=${disLon};\n`;
        data_map += `centerValue=${centerValue};\n`;
        data_map += `elevationPoint=${heightStr};`;

        updateMapInfo(data_map);
        addLog(infoStr, 'success');

        // --- Формируем таблицу 101×101 только для data_elevation (без индексов) ---
        const startRowIdx = rowCenter - halfSize;
        const endRowIdx   = rowCenter + halfSize;
        const startColIdx = colCenter - halfSize;
        const endColIdx   = colCenter + halfSize;

        const matrixRows = [];
        for (let rIdx = startRowIdx; rIdx <= endRowIdx; rIdx++) {
            const rowValues = [];
            for (let cIdx = startColIdx; cIdx <= endColIdx; cIdx++) {
                const latCell = lat0 + (rows - rIdx - 0.5) / rows;
                const lonCell = lon0 + (cIdx + 0.5) / cols;
                const val = getElevation(latCell, lonCell);
                const valStr = val === -9999 ? "NaN" : val.toString();
                rowValues.push(valStr);
            }
            matrixRows.push(rowValues.join(':'));
        }
        const tableStr = matrixRows.join(';');
        updateElevationTable(tableStr);

        addLog(`Вычислена высота для точки (${lat.toFixed(6)}, ${lon.toFixed(6)}) → ${heightStr}`, 'info');

        return interpolatedHeight;
    }
});
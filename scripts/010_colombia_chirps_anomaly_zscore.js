// ===== Imports (equivalentes al panel "Imports") =====
// EN: CHIRPS daily precipitation ImageCollection.
// ES: Colección CHIRPS de precipitación diaria.
var chir = ee.ImageCollection("UCSB-CHG/CHIRPS/DAILY"),
    // EN: Optional visualization params to reuse in Map.addLayer.
// ES: Parámetros de visualización opcionales para Map.addLayer.
    imageVisParam = {"opacity":1,"bands":["precipitation"],"min":101.46331971021714,"max":591.2452950302967,"gamma":1};

/**** ======================================================
   CHIRPS — Colombia | Monthly anomaly & standardized anomaly (Z)
   EN: This version aggregates to MONTHLY sums, computes
       (1) anomaly vs. same-calendar-month climatology and
       (2) standardized anomaly Z = (X - μ_m) / σ_m.
   ES: Esta versión agrega a SUMAS MENSUALES y calcula
       (1) anomalía vs. climatología del mismo mes calendario y
       (2) anomalía estandarizada Z = (X - μ_m) / σ_m.
========================================================= */

// ============== AOI Colombia ============================
// EN: AOI from a simple borders dataset (LSIB). Change the filter string to another country
//     or replace with your own FeatureCollection / geometry.
// ES: AOI desde LSIB. Cambia el nombre del país o reemplaza por tu propio FeatureCollection / geometría.
var colombia = ee.FeatureCollection('USDOS/LSIB_SIMPLE/2017')
  .filter(ee.Filter.eq('country_na', 'Colombia'))
  .union(1).geometry();
var geometry = colombia;

// EN: Map reference layers (outline/fill). You can hide by setting last arg = false.
// ES: Capas de referencia (borde/relleno). Puedes ocultarlas con el último arg = false.
Map.centerObject(geometry, 6);
var outline = ee.Image().paint(geometry, 0, 2);
Map.addLayer(outline, {palette: ['red']}, 'Colombia — borde');
var fill = ee.Image().paint(geometry, 1).selfMask();
Map.addLayer(fill, {palette: ['red'], opacity: 0.15}, 'Colombia — relleno', false);

// ============== Parameters / Parámetros =================
// EN: Core knobs to tweak dates, scales, CRS and export year.
// ES: Controles para ajustar fechas, escalas, CRS y año de exportación.
var band         = 'precipitation';

// --- DATE WINDOW (you can change) / VENTANA DE FECHAS (puedes cambiar) ---
// EN: end is EXCLUSIVE; '2025-01-01' covers up to Dec 2024.
// ES: el fin es EXCLUSIVO; '2025-01-01' cubre hasta dic 2024.
var time_start   = '1981-01-01';
var time_end     = '2025-01-01';

// EN: chart and export resolution (meters) and CRS (change if needed).
// ES: resolución (m) para gráficos/export y CRS (cámbialos si quieres).
var chart_scale  = 5000;
var export_scale = 5000;
var export_crs   = 'EPSG:4326';

// --- EXAMPLE YEAR TO EXPORT / AÑO DE EJEMPLO PARA EXPORTAR ---
// EN: Change yearExport to export maps for another year.
// ES: Cambia yearExport para exportar mapas de otro año.
var yearExport = 2010;
var yearStart = ee.Date.fromYMD(yearExport, 1, 1);
var yearEnd   = yearStart.advance(1, 'year');

// ============== Daily CHIRPS filtered / CHIRPS diario filtrado ==============
// EN: We filter DAILY first (source is daily), then aggregate to monthly.
// ES: Primero filtramos DIARIO (la fuente es diaria) y luego agregamos a mensual.
var daily = chir
  .select([band])
  .filterDate(time_start, time_end)
  .filterBounds(geometry);

print('# imágenes diarias filtradas / daily images:', daily.size());

// ============== Monthly aggregation (robust) / Agregado mensual (robusto) ==
// EN: Sums all daily images within each month. We store 'count' to drop empty months.
// ES: Suma las diarias dentro de cada mes. Guardamos 'count' para quitar meses vacíos.
function monthlyCollection(collection, startISO, endISO) {
  var start   = ee.Date(startISO);
  var end     = ee.Date(endISO);
  var nMonths = end.difference(start, 'month').floor();
  var seq     = ee.List.sequence(0, nMonths.subtract(1));

  return ee.ImageCollection(seq.map(function(i){
    i = ee.Number(i);
    var t0 = start.advance(i, 'month');
    var t1 = t0.advance(1, 'month');

    var monthCol = collection.filterDate(t0, t1);
    var count    = monthCol.size();              // EN/ES: # of daily images / # de diarias

    var img = monthCol.sum()                     // EN: monthly SUM (mm/month)
                                                   // ES: SUMA mensual (mm/mes)
      .set('system:time_start', t0.millis())
      .set('year',  t0.get('year'))
      .set('month', t0.get('month'))
      .set('count', count);

    return img;
  }));
}

// EN: Build monthly; we keep only months with count > 0.
// ES: Construye mensual; nos quedamos solo con meses con count > 0.
var monthly = monthlyCollection(daily, time_start, time_end)
  .filter(ee.Filter.gt('count', 0));

print('# imágenes mensuales / monthly images:', monthly.size());
print('Bandas primer mensual / first monthly band names:', ee.Image(monthly.first()).bandNames());
print('Count primer mensual / first monthly count:', ee.Image(monthly.first()).get('count'));

// ============== Climatology by month / Climatología por mes ================
// EN: μ_m and σ_m computed across all years for each calendar month (1..12).
// ES: μ_m y σ_m calculadas a lo largo de todos los años para cada mes calendario (1..12).
var climMeanByMonth = ee.ImageCollection(
  ee.List.sequence(1, 12).map(function(m){
    m = ee.Number(m);
    return monthly.filter(ee.Filter.eq('month', m))
      .mean().rename(band).set('month', m);
  })
);

var climStdByMonth = ee.ImageCollection(
  ee.List.sequence(1, 12).map(function(m){
    m = ee.Number(m);
    return monthly.filter(ee.Filter.eq('month', m))
      .reduce(ee.Reducer.stdDev()).rename('std').set('month', m);
  })
);

// ============== Anomaly & Z-score / Anomalía y Z-score =====================
// EN: Monthly anomaly = month − μ_m (same calendar month).
// ES: Anomalía mensual = mes − μ_m (mismo mes del calendario).
var anomaly = monthly.map(function(img){
  var m  = ee.Number(img.get('month'));
  var mu = ee.Image(climMeanByMonth.filter(ee.Filter.eq('month', m)).first());
  return img.select([band]).subtract(mu).rename('anomaly')
           .copyProperties(img, img.propertyNames());
});

// EN: Z = (month − μ_m) / σ_m, masking where σ_m == 0.
// ES: Z = (mes − μ_m) / σ_m, enmascarando donde σ_m == 0.
var zMonthly = monthly.map(function(img){
  var m   = ee.Number(img.get('month'));
  var mu  = ee.Image(climMeanByMonth.filter(ee.Filter.eq('month', m)).first());
  var sig = ee.Image(climStdByMonth.filter(ee.Filter.eq('month', m)).first());
  var z   = img.select(band).subtract(mu).divide(sig)
               .updateMask(sig.neq(0)).rename('z');
  return z.copyProperties(img, img.propertyNames());
});

// ============== Reference layers (optional) / Capas referencia (opcional) ==
var pr_mean_all = monthly.mean().rename('pr_mean'); // EN/ES: mean over whole period / media del periodo
Map.addLayer(pr_mean_all.clip(geometry), {}, 'PR mean (mm/mes)', false);

// ============== CHARTS (Console) / GRÁFICOS (Consola) ======================
// EN: Both charts are spatial means over the AOI. Change reducer/scale if needed.
// ES: Ambos gráficos son promedios espaciales sobre el AOI. Cambia reducer/scale si quieres.

// 1) Anomaly series / Serie de anomalía
print(
  ui.Chart.image.series({
    imageCollection: anomaly,
    region: geometry,
    reducer: ee.Reducer.mean(), // EN: change to median/percentile / ES: cambiar a mediana/percentil
    scale: chart_scale,
    xProperty: 'system:time_start'
  })
  .setChartType('ColumnChart')
  .setOptions({
    title: 'Monthly anomaly (CHIRPS) — Colombia (spatial mean)',
    hAxis: { title: 'Date / Fecha' },
    vAxis: { title: 'Anomaly (mm/month) / Anomalía (mm/mes)' }
  })
);

// 2) Z-score series / Serie de Z
print(
  ui.Chart.image.series({
    imageCollection: zMonthly,
    region: geometry,
    reducer: ee.Reducer.mean(),
    scale: chart_scale,
    xProperty: 'system:time_start'
  })
  .setChartType('ColumnChart')
  .setOptions({
    title: 'Standardized anomaly (Z) — Colombia (spatial mean)',
    hAxis: { title: 'Date / Fecha' },
    vAxis: { title: 'σ' }
  })
);

// ============== Quick maps (optional) / Mapas rápidos (opcional) ==========
// EN: Uncomment or adjust min/max to visualize a specific month or historical means.
// ES: Descomenta o ajusta min/max para ver un mes específico o promedios históricos.

// Specific month / Mes específico
var an_jan2010 = anomaly.filterDate('2010-01-01','2010-02-01').first().clip(geometry);
Map.addLayer(an_jan2010, {min:-100, max:100}, 'Anomaly Jan 2010', false);

var z_jan2010 = zMonthly.filterDate('2010-01-01','2010-02-01').first().clip(geometry);
Map.addLayer(z_jan2010, {min:-2, max:2}, 'Z Jan 2010', false);

// Historical means / Promedios históricos
Map.addLayer(anomaly.mean().clip(geometry), {min:-20, max:20}, 'Mean anomaly (all years)', false);
Map.addLayer(zMonthly.mean().clip(geometry), {min:-0.5, max:0.5}, 'Mean Z (all years)', false);

// ============== Stacks + Export / Apilados + Export ========================
// EN: Build band-stacks for the selected year (one band per month).
// ES: Construye “stacks” de bandas para el año seleccionado (una banda por mes).

var anomalyStack = anomaly.filterDate(yearStart, yearEnd)
  .map(function(img){
    var d = ee.Date(img.get('system:time_start'));
    return img.rename([ee.String('anom_').cat(d.format('YYYY_MM'))]);
  })
  .toBands().clip(geometry).float();

var zStack = zMonthly.filterDate(yearStart, yearEnd)
  .map(function(img){
    var d = ee.Date(img.get('system:time_start'));
    return img.rename([ee.String('z_').cat(d.format('YYYY_MM'))]);
  })
  .toBands().clip(geometry).float();

Map.addLayer(anomalyStack, {}, 'Anomaly ' + yearExport + ' (stack)', false);
Map.addLayer(zStack, {min:-2, max:2}, 'Z ' + yearExport + ' (stack)', false);

// EN: Exports — change description/folder/scale/crs/region as needed.
// ES: Exportaciones — cambia description/folder/scale/crs/region según necesites.
Export.image.toDrive({
  image: anomalyStack,
  description: 'CHIRPS_anomaly_' + yearExport + '_Colombia',
  folder: 'precipitation',   // EN/ES: Drive folder / Carpeta en Drive
  region: geometry,          // EN/ES: Export extent / Extensión de exportación
  scale: export_scale,       // EN/ES: Pixel size in meters / Tamaño de píxel (m)
  crs: export_crs,           // EN/ES: Output projection / Proyección de salida
  maxPixels: 1e13
});

Export.image.toDrive({
  image: zStack,
  description: 'CHIRPS_Z_' + yearExport + '_Colombia',
  folder: 'precipitation',
  region: geometry,
  scale: export_scale,
  crs: export_crs,
  maxPixels: 1e13
});

/* ======================= QUICK GUIDE / GUÍA RÁPIDA =========================
EN: What you can change safely:
- AOI: replace `colombia` with another country or your own FeatureCollection.
- Dates: `time_start`, `time_end` (exclusive), and `yearExport` for stacks.
- Aggregation: in monthlyCollection, switch `.sum()` -> `.mean()` for average monthly precip.
- Charts: change reducer (mean/median/percentile), `chart_scale`, titles/axes.
- Maps: adjust visualization ranges `{min, max}`.
- Exports: change `description`, `folder`, `scale`, `crs`, `region` (e.g., a subregion geometry).

ES: Qué puedes cambiar sin problemas:
- AOI: reemplaza `colombia` por otro país o tu propio FeatureCollection.
- Fechas: `time_start`, `time_end` (exclusivo) y `yearExport` para apilados.
- Agregado: en monthlyCollection, cambia `.sum()` -> `.mean()` si prefieres promedio mensual.
- Gráficas: cambia el `reducer` (media/mediana/percentil), `chart_scale`, títulos/ejes.
- Mapas: ajusta rangos de visualización `{min, max}`.
- Exportaciones: cambia `description`, `folder`, `scale`, `crs`, `region` (p. ej., una subregión).
============================================================================ */

// ===== Imports (equivalent to GEE "Imports" panel) =====
// EN: CHIRPS daily precipitation ImageCollection (do not rename variable if other code depends on `chir`).
// ES: Colección de imágenes diarias CHIRPS (no cambies el nombre si otras partes usan `chir`).
var chir = ee.ImageCollection("UCSB-CHG/CHIRPS/DAILY"),
    // EN: Visualization parameters you can reuse in Map.addLayer (bands/min/max/gamma/opacity).
    // ES: Parámetros de visualización reutilizables en Map.addLayer (bandas/mín/máx/gamma/opacidad).
    imageVisParam = {"opacity":1,"bands":["precipitation"],"min":101.46331971021714,"max":591.2452950302967,"gamma":1};

/**** ====================================================== 
   Colombia as AOI (LSIB simple, lightweight)
   Colombia como AOI (LSIB simple, liviano)
========================================================= */

// EN: Load Colombia boundary from a simple global borders dataset.
// ES: Carga el límite de Colombia desde un dataset simple de fronteras globales.
var colombiaFC = ee.FeatureCollection('USDOS/LSIB_SIMPLE/2017')
  // EN: Filter by country name exactly matching 'Colombia'. You can change the string to another country.
  // ES: Filtra por nombre de país exactamente 'Colombia'. Puedes cambiar el texto por otro país.
  .filter(ee.Filter.eq('country_na', 'Colombia'));

// EN: Dissolve to a single geometry (union) and extract geometry object.
// ES: Disuelve a una sola geometría (union) y extrae el objeto geometría.
var colombia = colombiaFC.union(1).geometry();

// EN: (Optional) Use a generic name `geometry` so downstream code that expects it will work.
// ES: (Opcional) Usa el nombre genérico `geometry` para que el código posterior que lo espera funcione.
var geometry = colombia;

// EN: Center the map on the AOI at zoom ~6 (change zoom as you like).
// ES: Centra el mapa en el AOI con zoom ~6 (puedes cambiar el nivel de zoom).
Map.centerObject(colombia, 6);

// EN: Draw a red outline of the AOI; thickness=2 px (change color/thickness).
// ES: Dibuja el contorno rojo del AOI; grosor=2 px (cambia color/grosor).
var outline = ee.Image().paint(colombia, 0, 2);
Map.addLayer(outline, {palette: ['red']}, 'Colombia — borde');

// EN: Semi-transparent fill to see what’s selected (change color/opacity).
// ES: Relleno semitransparente para ver lo seleccionado (cambia color/opacidad).
var fill = ee.Image().paint(colombia, 1).selfMask();
Map.addLayer(fill, {palette: ['red'], opacity: 0.15}, 'Colombia — relleno');

// EN: Center again (redundant but harmless).
// ES: Centra de nuevo (redundante pero no afecta).
Map.centerObject(geometry);

// EN: Time window for filtering; END in GEE is exclusive when using full dates,
//     but here strings like '1981' and '2025' are allowed by the baseline approach.
// ES: Ventana temporal para filtrar; el FIN es exclusivo si usas fechas completas,
//     pero aquí cadenas como '1981' y '2025' son válidas en el método base.
var time_start = '1981', time_end = '2025';

// EN: Filter CHIRPS by date range; you can also add .filterBounds(geometry) to restrict spatially.
// ES: Filtra CHIRPS por fechas; puedes añadir .filterBounds(geometry) para restringir espacialmente.
var chirps = chir
  .filterDate(time_start, time_end);

// EN: Helper function to aggregate an ImageCollection into fixed time steps (e.g., monthly).
//     Params:
//       - collection: source ImageCollection
//       - start:      origin date (string or millis)
//       - count:      number of steps to generate
//       - interval:   step size (e.g., 1)
//       - unit:       unit of step ('month','day','year')
//     You can change count/interval/unit to build different periods.
// ES: Función auxiliar para agregar una ImageCollection en pasos fijos (ej., mensual).
//     Parámetros (ver arriba). Puedes cambiar count/interval/unit para otros periodos.
function temporal_collection(collection, start, count, interval, unit){
  // EN: Create [0, 1, ..., count-1].
  // ES: Crea [0, 1, ..., count-1].
  var seq = ee.List.sequence(0, ee.Number(count).subtract(1));
  // EN: Origin as ee.Date.
  // ES: Origen como ee.Date.
  var origin_date = ee.Date(start);
  // EN: Map each index to a time-sliced sum of images.
  // ES: Mapea cada índice a la suma de imágenes en la ventana temporal.
  return ee.ImageCollection(seq.map(function(i){
    var start_date = origin_date.advance(ee.Number(interval).multiply(i), unit);
    var end_date   = origin_date.advance(ee.Number(interval).multiply(ee.Number(i).add(1)), unit);
    // EN: Sum images within [start_date, end_date); change .sum() to .mean() if you need averages.
    // ES: Suma imágenes dentro de [start_date, end_date); cambia .sum() por .mean() si quieres promedios.
    return collection.filterDate(start_date, end_date).sum()
      // EN: Keep time properties so charts/export use the start of the period.
      // ES: Guarda propiedades de tiempo para que gráficos/export tomen el inicio del periodo.
      .set('system:time_start', start_date.millis())
      .set('system:time_end',   end_date.millis());
  }));
}

// EN: Build 528 monthly steps (1981–2024 inclusive) starting at 1981; interval=1 month.
//     If you change dates above, adjust `count` accordingly to avoid empty months.
// ES: Construye 528 pasos mensuales (1981–2024 inclusive) desde 1981; intervalo=1 mes.
//     Si cambias fechas arriba, ajusta `count` para evitar meses vacíos.
var monthly = temporal_collection(chirps, time_start, 528, 1, 'month');

// EN: Compute mean over all monthly images (climatology across entire period).
//     CHANGE: You could use .median() or .reduce(ee.Reducer.percentile([50])).
// ES: Calcula la media sobre todas las imágenes mensuales (climatología del periodo).
//     CAMBIO: Podrías usar .median() o .reduce(ee.Reducer.percentile([50])).
var pr_mean = monthly.mean();

// EN: Visualize the mean precipitation; you may pass `imageVisParam` to style it.
// ES: Visualiza la precipitación media; puedes pasar `imageVisParam` para estilizar.
Map.addLayer(pr_mean.clip(geometry), [], 'pr_mean', false);
// Example styling usage (optional):
// Map.addLayer(pr_mean.clip(geometry), imageVisParam, 'pr_mean (styled)', false);

// EN: Pixel-wise anomaly = monthly image − overall mean.
//     NOTE: This "baseline" subtracts a single overall mean (not month-of-year mean).
// ES: Anomalía por píxel = imagen mensual − media global.
//     NOTA: Este “baseline” resta una única media global (no la media del mismo mes del año).
var anomaly = monthly.map(function(img){
  return img.subtract(pr_mean)
    // EN: Preserve original properties (time) so charts work.
//  ES: Conserva propiedades originales (tiempo) para que los gráficos funcionen.
    .copyProperties(img, img.propertyNames());
});

// EN: Chart the spatial mean anomaly over the AOI (column chart).
//     CHANGE: reducer -> ee.Reducer.median() or a percentile; scale -> pixel size in meters.
// ES: Grafica la anomalía media espacial sobre el AOI (gráfico de columnas).
//     CAMBIO: reducer -> ee.Reducer.median() o percentil; scale -> tamaño de píxel en metros.
print(
  ui.Chart.image.series(anomaly, geometry, ee.Reducer.mean(), 
  5000, 'system:time_start').setChartType('ColumnChart')
);

// EN: Build a band-stack of anomalies for 2010 (Jan–Dec) and add to map.
//     CHANGE: adjust dates to any year range you need.
// ES: Crea un “stack” de bandas con anomalías de 2010 (ene–dic) y añádelo al mapa.
//     CAMBIO: ajusta las fechas al rango anual que necesites.
Map.addLayer(
  anomaly.filterDate('2010', '2011').toBands().clip(geometry),
  [],
  'anomaly2010',
  false
);

// EN: Export the 2010 anomaly band-stack to Google Drive.
//     CHANGE: description/folder/scale/crs; region must remain your AOI geometry.
// ES: Exporta el “stack” de anomalías 2010 a Google Drive.
//     CAMBIO: description/folder/scale/crs; region debe seguir siendo tu AOI.
Export.image.toDrive({
  image: anomaly.filterDate('2010', '2011').toBands().clip(geometry).float(),
  description: 'pr_anomaly2010',
  scale: 5000,        // EN/ES: pixel resolution in meters / resolución del píxel en metros
  region: geometry,   // EN/ES: export extent / extensión de exportación
  folder: 'precipitation', // EN/ES: Drive folder / carpeta en Drive
  crs: 'EPSG:4326',   // EN/ES: output projection / proyección de salida
  // EN: Consider adding maxPixels for large regions.
  // ES: Considera añadir maxPixels para regiones grandes.
  // maxPixels: 1e13
});

// rename table to ikonos
var ikonos = table;

var image = ee.ImageCollection('users/mattia80/WSF2015_v1').mosaic();        // overwrite Felix european subset
//var ikonos = ikonos.filterBounds(roi);

var label = 'ikonos_2008_grid_003_sel_sscIndex';
var exportFileFormat = 'GeoJSON';

//-------------------------------------------------------------------------------------------------------------//
//--------------------------------------------- Functions -----------------------------------------------------//
//-------------------------------------------------------------------------------------------------------------//

// ---> count number of pixels per segment (vectorized WSF)
function cntPxl(rst, polygon_id, vct) {
  /*
  Function takes a polygon of a feature collection & return the selcted (indexed) polygon as wll as the number of pixels in it
  rst         = Raster which will be used to count
  polygon_id  = Index of which polygon of the featureCollection will be used
  vct         = FeatureCollection
  */
  var vct_feature = ee.Feature(vct.toList(vct.size()).get(polygon_id));                                             // select feature of featureCollection via indexing (zero-indexed)
  var vct_countPxl = rst.reduceRegion(ee.Reducer.count(), vct_feature.geometry(), 30, null, null, false, 1e13)      // count pixel with the selected feature
                     .get('constant');
  return [vct_feature, vct_countPxl];

}

//---> calculate area per grid
function calcAreaGrid(rst, grid) {
  /*
  Function uses a polygon, calculates the area in square kilometer & return the square kilometer of the polygon (whole grid)
  rst         = Raster which will be used to count
  grid         = FeatureCollection
  */
  var area_pxl = rst.multiply(ee.Image.pixelArea())                                                 //Cartographically appropriate way to calculate area
                    .reduceRegion(ee.Reducer.sum(), grid.geometry(), 30, null, null, false, 1e13)
                    .get('constant');
  var area_km2 = ee.Number(area_pxl).divide(1e6);

  return [area_km2];

}

// ---> calculate area of vectorized WSF (one segment)
function calcArea(rst, polygon_id, vct){
    /*
  Function uses a polygon, calculates the area in square kilometer & return the square kilometer of the polygon
  rst         = Raster which will be used to count
  polygon_id  = Index of which polygon of the featureCollection will be used
  vct         = FeatureCollection
  */
  var vct_feature = ee.Feature(vct.toList(vct.size()).get(polygon_id));                             // zero-indexed
  var area_pxl = rst.multiply(ee.Image.pixelArea())                                                 //Cartographically appropriate way to calculate area
                    .reduceRegion(ee.Reducer.sum(), vct.geometry(), 30, null, null, false, 1e13)
                    .get('constant');
  var area_km2 = ee.Number(area_pxl).divide(1e6);

  return [area_km2];
}



//-------------------------------------------------------------------------------------------------------------//
//--------------------------------------- Script starts here --------------------------------------------------//
//-------------------------------------------------------------------------------------------------------------//

/*
Overview & description of the variables:
image       = WSF2015
ikonos      = IKONOS DLR footprints of the scenes
roi         = region of interest                            (for rough clipping/filtering)

total_features    = total number of features in collection
feature           = one footprint                                 (herein the ikonos collection)
img_clip          = clipped WSF                                   (herein with feature)
countPxl          = number of WSF pixels                          (in the clipped WSF)
area_km2          = area of the WSF                               (in the clipped WSF)
vectors           = vectorized WSF                                (in the clipped WSF)
vector_feature    = vectorized WSF filtered to IKONOS footprint   (vector filtered with single feature)
display           = show vectorized WSF on the map
pxl               = single polygon & number of pixels             (Polygon is one feature of the vectorized WSF, pxl[0] & pxl[1])
areaAdded         = vector_feature with area as attribute         (area is added in attribute table [google dialect = property])
mean_area         = calculated mean area                          (of the vectorized WSF within the feature)


Structure:
      0. Show basic data & metadata
      1. Get one feature                                                                  -> by list indexing
      2. Clip WSF to feature
      3. Derive settlements_pixels (settl_pix)                                            -> https://code.earthengine.google.com/b24cfb66585792b77f6336a8722d1081
      4. Derive area of the (clipped) WSF                                                 -> https://www.youtube.com/watch?v=6RieZmW2ekE
      5. Vectorization of the WSF                                                         -> Source: https://developers.google.com/earth-engine/reducers_reduce_to_vectors + https://gis.stackexchange.com/questions/255433/conversion-from-raster-to-vector-in-google-earth-engine + https://gis.stackexchange.com/questions/255433/conversion-from-raster-to-vector-in-google-earth-engine
      6. Visualize vectorized WSF                                                         -> Make a display image for the vectors, add it to the map.
      7. Get number of segments (within feature)
      8. Count pixels within one polygon & present selected polygons
      9. Calculate area & add to features                                                 -> Source: Add Area -> https://developers.google.com/earth-engine/feature_collection_mapping
      10. Calculate the mean area of a settlement object                                  -> https://developers.google.com/earth-engine/reducers_reduce_columns
      11. Derive the area of the largest object                                           -> https://developers.google.com/earth-engine/reducers_reduce_columns
      12. Burn attributes into feature
      13. Calculate SSC index
      14. Calculate mean of the SSC index
      15. Cacluate SSC index normalization
      16. Export the FeatureCollection as GeoJSON file

*/

//var WSF2015 = ee.ImageCollection('users/mattia80/WSF2015_v1').mosaic();
//Map.addLayer(WSF2015, {palette: "#ff0067"}, "WSF2015 v1");

// 0. Show basic data & metadata
var image = ee.Image(1).mask(image.gte(0.5));
image = image.updateMask(image.neq(0));

// Get a list of all metadata properties.
var properties = image.propertyNames();
//print('Metadata properties: ', properties);                                          // ee.List of metadata properties

// Define the visualization parameters.
var vizParams = {
  min: 0,
  max: 1,
  palette: ['#FFFFFF', 'red']
};

// Center the map and display raster & vector date
Map.centerObject(roi, 9);                          // Central europe
//Map.addLayer(image, vizParams, 'WSF2015 Europa')
//Map.addLayer(image.clip(roi), vizParams, 'WSF2015 Europa filtered')
//Map.addLayer(ikonos.filterBounds(roi), {}, 'IKONOS DLR regions final data', true);    // Visualize shapefile


// General variables
var total_features = ikonos.size();
var roi_features = ikonos;//.filterBounds(roi).size();

// Print numbers of feature collections
//print('Count total number of features:', total_features);                           // print total number of features.
//print('Counted features after filtering by size:', roi_features);                   // print for region of interest

// Get area of the feature & add it to the featureCollection                        -> Source: Add Area -> https://developers.google.com/earth-engine/feature_collection_mapping
var addArea = function(feat) {                                                      // This function computes the feature's geometry area and adds it as a property.
  return feat.set({gee_ftr_area_km2: feat.geometry().area(10).divide(1e6)});                             // .divide(1e6) -> km2   .area(???) = maxError -> https://gis.stackexchange.com/questions/247234/google-earth-engine-trying-to-find-areas-of-multiple-water-patches-in-an-image
};
var ikonos_area = ikonos.map(addArea);                                              // Map the area getting function over the FeatureCollection.
//print('Area added to ionos footprints', ikonos_area.first());


// 1. Get one feature by list indexing i.e. get value of 4. feature                 -> https://gis.stackexchange.com/questions/328118/subset-featurecollection-by-position-google-earth-engine & https://gis.stackexchange.com/questions/328118/subset-featurecollection-by-position-google-earth-engine
var ftr = ee.FeatureCollection(ikonos);//.filterBounds(roi));
//print('Filtered features',ftr);
//Map.addLayer(ftr, {}, 'ROI IKONOS footprints', true);

var ikonos_area = ftr.map(addArea);
//print('ikonos area roi (geometry)', ikonos_area);


var calcSSC = function(feature){

// 2. Clip WSF to feature
var img_clip = image.clip(feature);                                                   // clip WSF with feature
//Map.addLayer(img_clip, vizParams, 'WSF2015 feature clip');                          // visualize clipped WSF


// 3. Derive settlements_pixels (settl_pix)                                                   -> https://code.earthengine.google.com/b24cfb66585792b77f6336a8722d1081
var countPxl = image.reduceRegion(ee.Reducer.count(),feature.geometry(), 10, null, null, false, 1e13)
                   .get('constant');
//print('Total number of pixels of clipped image: -> settlement_pixels', countPxl);                     // -> settlement_pixels


// 4. Derive area of the WSF                                                                  -> https://www.youtube.com/watch?v=6RieZmW2ekE
var area_pxl = image.multiply(ee.Image.pixelArea())                                           //Cartographically appropriate way to calculate area
                    .reduceRegion(ee.Reducer.sum(), feature.geometry(), 10, null, null, false, 1e13)
                    .get('constant');
var area_km2 = ee.Number(area_pxl).divide(1e6);
//print ('Area in km² (using ee.Image.pixelArea): -> sum_area_settl_objects', area_km2);                // -> sum_area_settl_objects


// 5. Vectorization of the WSF                                                                -> Source: https://developers.google.com/earth-engine/reducers_reduce_to_vectors + https://gis.stackexchange.com/questions/255433/conversion-from-raster-to-vector-in-google-earth-engine + https://gis.stackexchange.com/questions/255433/conversion-from-raster-to-vector-in-google-earth-engine
var vectors = img_clip.reduceToVectors({                                                      // Vecorized WSF
  geometry: feature.geometry(),
  crs: 'EPSG:4326',
  scale: 35,
  geometryType: 'polygon',
  eightConnected: false,
  labelProperty: 'image',
  reducer: ee.Reducer.countEvery(),
  maxPixels: 15000000
});


// 6. Visualize vectorized WSF                                                                -> Make a display image for the vectors, add it to the map.
var vector_feature = vectors.filterBounds(feature.geometry());                                // filter (clip) with feature extent
var display = ee.Image(0).updateMask(0).paint(vector_feature, '000000', 3);                   // add vector layer to map
//Map.addLayer(display, {palette: '000000'}, 'Vectorized and clipped WSF');


// 7. Get number of segments (within feature)
//print('Polygons information within feature:', vector_feature);
//print('Number of polygons within feature:', vector_feature.size());                                     // -> number_of_segments (see below addNoSeg)


// 8. Count pixels within one polygon & present selected polygon
var pxl = cntPxl(image, 0, vector_feature);                                                  // apply function
//print(x)
//Map.addLayer(pxl[0], {}, 'Selected vectorized WSF area', true);                              // add polygon to the map
//print('Total number of pixels within one polygon', pxl[1]);                                  // print the number of pixels within this polygon


// 9. Calculate area & add to features                                                       -> Source: Add Area -> https://developers.google.com/earth-engine/feature_collection_mapping
var addArea = function(feat) {                                                               // This function computes the feature's geometry area and adds it as a property.
  return feat.set({area_km2: feat.geometry().area(10).divide(1e6)});                          // .divide(1e6) -> km2   .area(???) = maxError -> https://gis.stackexchange.com/questions/247234/google-earth-engine-trying-to-find-areas-of-multiple-water-patches-in-an-image
};
var areaAdded = vector_feature.map(addArea);                                                 // Map the area getting function over the FeatureCollection.
//print('Area added to feature', areaAdded.first());


// 10. Calculate the mean area of a settlement object                                        -> https://developers.google.com/earth-engine/reducers_reduce_columns               -> https://gis.stackexchange.com/questions/329921/getting-values-from-datadictionary-in-google-earth-engine
var mean_area = areaAdded.reduceColumns({                                                    // Compute mean
  reducer: ee.Reducer.mean(),
  selectors: ['area_km2'],
});
//print('Mean area of (vectorized) WSF polygons', mean_area);                                              // -> mean_area_settl_obj


// 11. Derive the area of the largest object                                                 -> https://developers.google.com/earth-engine/reducers_reduce_columns
var max_area = areaAdded.reduceColumns({                                                    // Compute mean
  reducer: ee.Reducer.max(),
  selectors: ['area_km2'],
});
//print('Area of the largest WSF polygon (within vectorized WSF)', max_area);                              // -> area_largest_object


//print('Vectorized WSF', vector_feature);
//print('footprint',feature);

// 11. Derive the area of the largest object                                                 -> https://developers.google.com/earth-engine/reducers_reduce_columns

// 12. Burn attributes into feature
var meanArea = ee.Dictionary({gee_meanArea: mean_area.getNumber("mean")});
var maxArea = ee.Dictionary({gee_maxArea: max_area.getNumber("max")});
var sumArea = ee.Dictionary({gee_sumArea: area_km2});
var urbPxl = ee.Dictionary({gee_urbPxl: ee.Number(countPxl)});
var noSeg = ee.Dictionary({gee_noSeg: ee.Number(vector_feature.size())});

/*var meanArea = ee.Dictionary({gee_meanArea:mean_area.getNumber("mean")});                                      // Use getInfo() to convert results from server side to client side
var maxArea = ee.Dictionary({gee_maxArea: max_area.getNumber("max")});                                          // client side -> .getInfo()["max"]};
var sumArea = ee.Dictionary({gee_sumArea: area_km2});
var urbPxl = ee.Dictionary({gee_urbPxl: countPxl});
var noSeg = ee.Dictionary({gee_noSeg: vector_feature.size()});                                                  // add ssc index parameter -> number_of_segments (noSeg)
*/
// add values (dictionaries) to the feature
var feature_new = feature.set(meanArea);
var feature_new2 = feature_new.set(maxArea);
var feature_new3 = feature_new2.set(sumArea);
var feature_new4 = feature_new3.set(urbPxl);
var feature_new5 = feature_new4.set(noSeg);
var updatedFeature = feature_new5;
// compare original & new feature
//print('Original feature column structure (footprint)', feature);
//print('Feature (footprint) added rest of parameters', updatedFeature);

// 11. Derive the area of the largest object                                                 -> https://developers.google.com/earth-engine/reducers_reduce_columns

// 12. Burn attributes into feature
// 13.  Calculate SSC index                                                                 -> Paper: https://elib.dlr.de/130168/   -> formula: ssc = (gee_urbPxl / gee_noSeg) * (gee_sumArea, gee_ftr_area_m2) * (gee_maxArea, gee_meanArea)
// divide parameters
var ssc_div1 = updatedFeature.getNumber('gee_urbPxl').divide(updatedFeature.getNumber('gee_noSeg'));
var ssc_div2 = updatedFeature.getNumber('gee_sumArea').divide(updatedFeature.getNumber('gee_ftr_area_km2'));
var ssc_div3 = updatedFeature.getNumber('gee_maxArea').divide(updatedFeature.getNumber('gee_meanArea'));

//print('ssc div1', ssc_div1);
//print('ssc div2', ssc_div2);
//print('ssc div3', ssc_div3);

// multiply
var ssc_p1 = ssc_div1.multiply(ssc_div2);
var ssc = ssc_p1.multiply(ssc_p1);
//print('SSC index', ssc);                                                                      // print SSC index for one feature
var ssc_index = ee.Dictionary({gee_ssc_index: ssc});
var x = ee.Feature(updatedFeature.set(ssc_index));                                                          // add SSC index to attribute table (property)

return ee.Feature(updatedFeature.set({gee_ssc_index: ssc}));

};

var ftrCol = ikonos_area.map(calcSSC);
//print('SSC', ftrCol.first());

// 11. Derive the area of the largest object                                                 -> https://developers.google.com/earth-engine/reducers_reduce_columns
// 12. Burn attributes into feature
// 13.  Calculate SSC index
// 14. Calculate mean of the SSC index
var ssc_mean = ftrCol
  .reduceColumns({                                                    // Compute mean
    reducer: ee.Reducer.mean(),
    selectors: ['gee_ssc_index'],
});

var ssc_min = ftrCol
  .reduceColumns({                                                    // Compute mean
    reducer: ee.Reducer.min(),
    selectors: ['gee_ssc_index'],
});

var ssc_max = ftrCol
  .reduceColumns({                                                    // Compute mean
    reducer: ee.Reducer.max(),
    selectors: ['gee_ssc_index'],
});

//var ssc_min = ssc_mean.getNumber("mean");
var ssc_min = ssc_min.getNumber("min");
var ssc_max = ssc_max.getNumber("max");

//print('Min value of the SSC index', ssc_min);
//print('Max value of the SSC index', ssc_max);

// 11. Derive the area of the largest object                                                 -> https://developers.google.com/earth-engine/reducers_reduce_columns
// 12. Burn attributes into feature
// 13.  Calculate SSC index
// 14. Calculate mean of the SSC index
// 15. Cacluate SSC index normalization
var normSSC = function(feature){                                                         // Normalization formula -> result = (val - min(val_lst)) / (max(val_lst) - min(val_lst)) * 10

  var val = feature.getNumber("gee_ssc_index");
  var p1 = val.subtract(ssc_min);
  var p2 = ssc_max.subtract(ssc_min);
  var p3 = p1.divide(p2);
  var res = p3.multiply(10);

  return feature.set({gee_ssc_norm:res});
};

var ssc_norm = ftrCol.map(normSSC);
//print('Normalized SSC Index', ssc_norm);




// 16. Export the FeatureCollection to a GeoJSON file.
Export.table.toDrive({
  collection: ssc_norm,
  description:label,
  fileFormat: exportFileFormat
});
print('done');

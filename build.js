// Importar las librerías necesarias
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs-extra');
const ejs = require('ejs');
require('dotenv').config();

// --- CONFIGURACIÓN ---
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const GOOGLE_DRIVE_COVERS_FOLDER_ID = process.env.GOOGLE_DRIVE_COVERS_FOLDER_ID;
const GOOGLE_DRIVE_PORTFOLIOS_FOLDER_ID = process.env.GOOGLE_DRIVE_PORTFOLIOS_FOLDER_ID;
const SHEET_RANGE = 'Sheet1!A2:E';

// --- RUTAS DEL PROYECTO ---
// Nota: CREDENTIALS_PATH solo se usa en desarrollo local si no se usa la variable de entorno
const CREDENTIALS_PATH = path.join(process.cwd(), 'google-credentials.json'); 
const TEMPLATES_DIR = path.join(process.cwd(), 'templates');
const OUTPUT_DIR = path.join(process.cwd(), 'public');
const CSS_SOURCE_PATH = path.join(process.cwd(), 'src', 'css', 'style.css');
const CSS_OUTPUT_PATH = path.join(OUTPUT_DIR, 'style.css');


// --- FUNCIONES DE AYUDA (HELPERS) ---

/**
 * Se autentica con la API de Google usando las credenciales.
 * Maneja tanto el archivo local como la variable de entorno codificada en Base64 para Netlify.
 */
async function authenticateGoogle() {
    // Si la variable de entorno existe (en Netlify), la decodifica desde Base64.
    if (process.env.GOOGLE_CREDENTIALS_JSON) {
        // Decodifica la cadena Base64 para obtener el JSON original
        const decodedCredentials = Buffer.from(process.env.GOOGLE_CREDENTIALS_JSON, 'base64').toString('utf8');
        
        // === AÑADE ESTA LÍNEA TEMPORALMENTE PARA DEPURACIÓN ===
        // ¡IMPORTANTE! Elimínala después de depurar para no exponer tus credenciales.
        console.log("DEBUG: Decoded Google Credentials JSON (check this in Netlify logs):", decodedCredentials); 
        // =======================================================
        
        const credentials = JSON.parse(decodedCredentials);
        
        return google.auth.fromJSON(credentials, {
            scopes: [
                'https://www.googleapis.com/auth/spreadsheets.readonly',
                'https://www.googleapis.com/auth/drive.readonly',
            ],
        });
    } 
    // Si no, usa el archivo local (para desarrollo en tu PC).
    else {
        const auth = new google.auth.GoogleAuth({
            keyFile: CREDENTIALS_PATH,
            scopes: [
                'https://www.googleapis.com/auth/spreadsheets.readonly',
                'https://www.googleapis.com/auth/drive.readonly',
            ],
        });
        return await auth.getClient();
    }
}

/**
 * Obtiene los datos de texto de los modelos desde la hoja de cálculo.
 */
async function fetchSheetData(authClient) {
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: SHEET_RANGE,
    });
    if (!response.data.values) {
        console.log('No data found in sheet.');
        return [];
    }
    const models = response.data.values.map(row => ({
        modelSlug: row[0]?.trim() || '', fullName: row[1]?.trim() || '',
        gender: row[2]?.trim().toLowerCase() || 'unassigned', description: row[3]?.trim() || '',
        instagramHandle: row[4]?.trim() || ''
    }));
    console.log(`Successfully fetched ${models.length} text data rows from the sheet.`);
    return models;
}

/**
 * Busca el ID de una sub-carpeta por su nombre dentro de una carpeta padre.
 */
async function findFolderIdByName(drive, parentId, folderName) {
    if (!parentId || !folderName) {
        console.warn(`findFolderIdByName: Missing parentId (${parentId}) or folderName (${folderName}). Returning null.`);
        return null;
    }
    try {
        const res = await drive.files.list({
            q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and name='${folderName}' and trashed=false`,
            fields: 'files(id)',
            pageSize: 1
        });
        if (res.data.files.length) {
            console.log(`Found folder '${folderName}' with ID: ${res.data.files[0].id}`);
            return res.data.files[0].id;
        } else {
            console.warn(`Folder '${folderName}' not found in parent ID '${parentId}'.`);
            return null;
        }
    } catch (error) {
        console.error(`Error finding folder '${folderName}' in parent ID '${parentId}':`, error.message);
        throw error; // Re-lanza el error para que buildSite lo capture
    }
}

/**
 * Obtiene una lista de archivos de imagen de una carpeta de Drive.
 */
async function getImagesFromFolder(drive, folderId) {
    if (!folderId) {
        console.warn('getImagesFromFolder: Missing folderId. Returning empty array.');
        return [];
    }
    try {
        const res = await drive.files.list({
            q: `'${folderId}' in parents and mimeType contains 'image/' and trashed=false`,
            fields: 'files(id, name, thumbnailLink)',
            pageSize: 50
        });
        console.log(`Found ${res.data.files ? res.data.files.length : 0} images in folder ID '${folderId}'.`);
        return res.data.files || [];
    } catch (error) {
        console.error(`Error getting images from folder ID '${folderId}':`, error.message);
        throw error; // Re-lanza el error
    }
}

/**
 * Busca todas las imágenes de portada en las carpetas 'men' y 'women'.
 */
async function fetchCoverImages(drive) {
    const coverImages = new Map();
    console.log(`Fetching cover images from base folder ID: ${GOOGLE_DRIVE_COVERS_FOLDER_ID}`);

    const menCoversFolderId = await findFolderIdByName(drive, GOOGLE_DRIVE_COVERS_FOLDER_ID, 'men');
    if (menCoversFolderId) {
        const menFiles = await getImagesFromFolder(drive, menCoversFolderId);
        menFiles.forEach(file => {
            if (file && file.name) {
                coverImages.set(path.parse(file.name).name, file.thumbnailLink);
            }
        });
        console.log(`Added ${menFiles.length} male cover images.`);
    } else {
        console.warn('Men covers folder not found or accessible.');
    }

    const womenCoversFolderId = await findFolderIdByName(drive, GOOGLE_DRIVE_COVERS_FOLDER_ID, 'women');
    if (womenCoversFolderId) {
        const womenFiles = await getImagesFromFolder(drive, womenCoversFolderId);
        womenFiles.forEach(file => {
            if (file && file.name) {
                coverImages.set(path.parse(file.name).name, file.thumbnailLink);
            }
        });
        console.log(`Added ${womenFiles.length} female cover images.`);
    } else {
        console.warn('Women covers folder not found or accessible.');
    }

    console.log(`Total successfully fetched ${coverImages.size} cover images.`);
    return coverImages;
}

/**
 * Renderiza una plantilla EJS y la guarda como un archivo HTML.
 */
async function renderAndSave(templateName, data, outputPath) {
    const templatePath = path.join(TEMPLATES_DIR, templateName);
    try {
        const html = await ejs.renderFile(templatePath, data, { async: true });
        await fs.outputFile(outputPath, html);
        console.log(`Rendered and saved: ${outputPath}`);
    } catch (error) {
        console.error(`Error rendering or saving ${templateName} to ${outputPath}:`, error.message);
        throw error;
    }
}


// --- SCRIPT PRINCIPAL DE CONSTRUCCIÓN ---

async function buildSite() {
    console.log('Starting site build...');
    
    // 1. Limpiar el directorio de salida
    await fs.emptyDir(OUTPUT_DIR);
    console.log(`Cleaned output directory: ${OUTPUT_DIR}`);

    // 2. Autenticar con Google
    const authClient = await authenticateGoogle();
    const drive = google.drive({ version: 'v3', auth: authClient });
    
    // 3. Obtener datos en paralelo
    console.log('Fetching sheet data and cover images...');
    const [allModels, coverImages] = await Promise.all([
        fetchSheetData(authClient),
        fetchCoverImages(drive)
    ]);
    
    // 4. Encontrar carpetas de portafolios (si existen)
    console.log(`Fetching portfolio folders from base ID: ${GOOGLE_DRIVE_PORTFOLIOS_FOLDER_ID}`);
    const menPortfolioFolderId = await findFolderIdByName(drive, GOOGLE_DRIVE_PORTFOLIOS_FOLDER_ID, 'men');
    const womenPortfolioFolderId = await findFolderIdByName(drive, GOOGLE_DRIVE_PORTFOLIOS_FOLDER_ID, 'women');

    // 5. Enriquecer datos de modelos con imágenes de portafolio
    console.log('Processing model data and fetching portfolio images...');
    const modelsWithData = await Promise.all(allModels.map(async (model) => {
        const coverImageUrl = coverImages.get(model.modelSlug) || `https://via.placeholder.com/300x400.png?text=No+Image`;
        const parentPortfolioFolderId = model.gender === 'men' ? menPortfolioFolderId : womenPortfolioFolderId;
        
        // Evita buscar en una carpeta padre nula si no se encontró
        let portfolioImageUrls = [];
        if (parentPortfolioFolderId) {
            const modelPortfolioFolderId = await findFolderIdByName(drive, parentPortfolioFolderId, model.modelSlug);
            if (modelPortfolioFolderId) {
                const portfolioFiles = await getImagesFromFolder(drive, modelPortfolioFolderId);
                portfolioImageUrls = portfolioFiles.map(file => file.thumbnailLink ? file.thumbnailLink.replace('=s220', '=s1600') : '');
                console.log(`- Found ${portfolioImageUrls.length} portfolio images for ${model.fullName} (Slug: ${model.modelSlug})`);
            } else {
                console.warn(`- Model portfolio folder '${model.modelSlug}' not found in parent ID '${parentPortfolioFolderId}'.`);
            }
        } else {
            console.warn(`- Skipping portfolio images for ${model.fullName} as parent folder ID for gender '${model.gender}' is not found.`);
        }
        
        return { ...model, coverImageUrl, portfolioImageUrls };
    }));

    // 6. Filtrar modelos por género
    const menModels = modelsWithData.filter(model => model.gender === 'men');
    const womenModels = modelsWithData.filter(model => model.gender === 'women');

    // 7. Renderizar páginas individuales de modelos
    console.log('Rendering individual model pages...');
    for (const model of modelsWithData) {
        if (model.gender === 'unassigned') {
            console.warn(`Skipping unassigned model: ${model.fullName}`);
            continue;
        }
        const modelOutputPath = path.join(OUTPUT_DIR, 'models', model.gender, `${model.modelSlug}.html`);
        await renderAndSave('model-page.ejs', { model }, modelOutputPath);
    }

    // 8. Renderizar páginas de categorías
    console.log('Rendering category pages...');
    if (menModels.length > 0) {
        await renderAndSave('category-page.ejs', { models: menModels, title: "Men's Portfolio" }, path.join(OUTPUT_DIR, 'men.html'));
    } else {
        console.log("No men models found to render men.html.");
    }
    if (womenModels.length > 0) {
        await renderAndSave('category-page.ejs', { models: womenModels, title: "Women's Portfolio" }, path.join(OUTPUT_DIR, 'women.html'));
    } else {
        console.log("No women models found to render women.html.");
    }

    // 9. Renderizar página de índice
    console.log('Rendering index page...');
    await renderAndSave('index-page.ejs', { hasMen: menModels.length > 0, hasWomen: womenModels.length > 0 }, path.join(OUTPUT_DIR, 'index.html'));
    
    // 10. Copiar CSS
    console.log('Copying CSS...');
    if (await fs.pathExists(CSS_SOURCE_PATH)) {
        await fs.copy(CSS_SOURCE_PATH, CSS_OUTPUT_PATH);
        console.log('Copied style.css to public/ directory.');
    } else {
        console.warn(`CSS file not found at ${CSS_SOURCE_PATH}. Skipping CSS copy.`);
    }

    console.log('\nSite build completed successfully!');
}

// Ejecutamos el script y capturamos cualquier error
buildSite().catch(err => {
    console.error("\nBUILD FAILED:", err);
    // Asegurarse de que el proceso termine con un código de error para Netlify
    process.exit(1); 
});
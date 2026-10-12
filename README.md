# Mi Rutina

App estática que lee el plan del entrenador desde Google Sheets. La planilla define los ejercicios, series, descansos, RPE y estructura. La app permite registrar pesos, observaciones y progreso sin editar esos elementos del plan.

## Una rutina por enlace

La app acepta un enlace de entrada con estos parámetros:

```text
https://TU-DOMINIO/?rutina=ID_DE_LA_PLANILLA&nombre=Nombre
```

`rutina` también puede contener la URL completa de Google Sheets, codificada como parámetro. Los identificadores de otras personas no necesitan incorporarse al código. El botón de configuración permite cambiar la fuente de lectura.

Sin parámetros, se abre la última planilla cargada correctamente en ese navegador. Si nunca se configuró una, se conserva la fuente original de Gustavo. Un enlace inválido no carga silenciosamente la planilla original.

El formato compatible incluye pestañas `Semana N` o `Entrenamiento en casa`, días `DÍA N`, encabezados de ejercicios y columnas de series, descanso, peso y observaciones. Las rutinas pueden tener ejercicios diferentes. Para otras planillas también se admiten pestañas `Plan N`, ordenadas por número junto con las semanas, y se leen los valores tal como aparecen en Excel. Esto evita mostrar números internos en celdas con formato de hora o fecha. Se conservan el lector, las pestañas y las etiquetas anteriores para la planilla original de Gustavo.

Las pestañas de seguimiento sin ejercicios no se incorporan al entrenamiento. Peso y observaciones son columnas opcionales: los registros pueden guardarse localmente, pero solo se envían a Google Sheets los campos cuya columna existe en el encabezado. La app no agrega columnas ni modifica la estructura de la planilla.

## Conservación y separación de registros

Pesos, notas, progreso, secciones, última sesión y conexión de escritura se guardan bajo el ID de cada planilla en el almacenamiento local del navegador. Cambiar, reiniciar o limpiar una rutina no modifica los registros de otra.

Al actualizar la app en el mismo dominio, la migración copia los registros antiguos a la última planilla que estaba configurada. Las claves anteriores quedan intactas como respaldo y no se vuelven a importar. Si la versión anterior ya había mezclado registros al cambiar de planilla, no es posible reconstruir automáticamente a quién pertenecían; se conserva la información disponible sin eliminarla.

La conexión antigua de escritura se conserva únicamente para la planilla original. Si el enlace anterior apuntaba a otra planilla, el destino antiguo queda en el respaldo y se exige verificar una conexión nueva.

Esta separación no es un sistema de cuentas ni de acceso privado. Los registros locales no se sincronizan automáticamente entre celulares, navegadores o dominios. Una URL de vista previa tiene almacenamiento diferente al de producción; no mostrará el historial local del otro dominio.

## Guardado opcional en Google Sheets

La carga y el registro local funcionan sin Apps Script. Las conexiones nuevas usan la versión incluida en `apps-script-webhook.gs`:

1. El propietario autorizado de la planilla instala el script dentro de esa planilla y lo publica como aplicación web.
2. Al tocar **Guardar Sheet**, se configura la URL `/exec` correspondiente a esa rutina.
3. La app consulta la identidad de la planilla y rechaza otro ID antes de enviar registros.
4. El script valida el ID y el lote completo; solo acepta columnas de peso y observaciones en filas de ejercicios.

No se despliega ni modifica ningún Apps Script por actualizar este repositorio. El script nuevo requiere el cliente nuevo; no instalarlo sobre una conexión que todavía utilice el cliente anterior.

La conexión antigua de Gustavo mantiene el envío anterior, aislado a su planilla. Como utiliza `no-cors`, la app informa que el envío se realizó y pide confirmar el resultado en la planilla. No presenta ese envío como un guardado verificado. Las conexiones nuevas solo muestran confirmación cuando reciben una respuesta válida del destino.

## Pruebas

Requiere Node.js; las pruebas no usan paquetes externos ni acceden a Google Sheets:

```bash
node --test tests/*.test.cjs
```

Para comparar también el lector de Gustavo con una copia de la versión anterior:

```bash
ROUTINE_BASELINE_PATH=/ruta/al/index-anterior.html node --test tests/*.test.cjs
```

Se prueban migración, conservación de claves originales, separación de estados, cambios de planilla, reapertura, destinos de escritura, cargas simultáneas y rechazo de formatos/enlaces inválidos. Las pruebas de la app ejecutan su JavaScript con un DOM y respuestas de red simulados. No sustituyen una prueba visual en el navegador ni la carga y escritura de las planillas reales.

Para verificar un XLSX privado con el lector real de SheetJS 0.18.5, sin subirlo al repositorio:

```bash
ROUTINE_XLSX_PATH=/ruta/archivo.xlsx ROUTINE_SHEETJS_PATH=/ruta/xlsx.full.min.js node --test tests/*.test.cjs
```

Esta prueba opcional usa un archivo con el formato de seis columnas (ejercicio, video, series, descanso, RPE y peso). Compara todas las filas con video y series contra los ejercicios cargados, sus valores visibles y coordenadas. Comprueba además que el archivo permanezca idéntico y que los registros anteriores sigan separados. La descarga desde Google se sustituye por el archivo adjunto; la conversión XLSX y el JavaScript de la app son reales. Puede combinarse con `ROUTINE_BASELINE_PATH` para comparar también el lector original.

Se validó el Excel proporcionado: las tres pestañas de rutina se interpretan correctamente después de agregar soporte para `Plan N` y formatos de celdas. El archivo privado no está incluido en el repositorio.

## Verificación pendiente antes de producción

- Comprobar la descarga directa desde el enlace de Google Sheets en el navegador. La validación del Excel adjunto no confirma los permisos ni la disponibilidad de esa URL.
- Confirmar en un celular el flujo de entrada, instalación y recarga con el enlace propio.
- Si se necesita enviar pesos y notas a Google Sheets, configurar y verificar la conexión específica con autorización del propietario de la planilla.
- Publicar conservando el dominio usado por Gustavo para que su navegador pueda migrar los registros existentes.

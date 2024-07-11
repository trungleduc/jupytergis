import { JupyterFrontEnd } from '@jupyterlab/application';
import { Dialog, WidgetTracker, showErrorMessage } from '@jupyterlab/apputils';
import { PathExt } from '@jupyterlab/coreutils';
import { ITranslator } from '@jupyterlab/translation';
import { redoIcon, undoIcon } from '@jupyterlab/ui-components';
import {
  IDict,
  IGeoJSONSource,
  IJGISFormSchemaRegistry,
  IJGISLayer,
  IJGISLayerBrowserRegistry,
  IJGISSource,
  IJupyterGISModel
} from '@jupytergis/schema';
import { UUID } from '@lumino/coreutils';
import { Ajv } from 'ajv';
import * as geojson from 'geojson-schema/GeoJSON.json';

import {
  DataErrorDialog,
  DialogAddDataSourceBody,
  FormDialog
} from './formdialog';
import { geoJSONIcon } from './icons';
import { LayerBrowserWidget } from './dialogs/layerBrowserDialog';
import { GeoJSONLayerDialog } from './dialogs/geoJsonLayerDialog';
import { JupyterGISWidget } from './widget';

/**
 * The command IDs.
 */
export namespace CommandIDs {
  export const redo = 'jupytergis:redo';
  export const undo = 'jupytergis:undo';

  export const openLayerBrowser = 'jupytergis:openLayerBrowser';

  export const newGeoJSONLayer = 'jupytergis:newGeoJSONLayer';
  export const newGeoJSONSource = 'jupytergis:newGeoJSONSource';
  export const newVectorLayer = 'jupytergis:newVectorLayer';
}

/**
 * Add the commands to the application's command registry.
 */
export function addCommands(
  app: JupyterFrontEnd,
  tracker: WidgetTracker<JupyterGISWidget>,
  translator: ITranslator,
  formSchemaRegistry: IJGISFormSchemaRegistry,
  layerBrowserRegistry: IJGISLayerBrowserRegistry
): void {
  Private.updateFormSchema(formSchemaRegistry);
  const trans = translator.load('jupyterlab');
  const { commands } = app;

  commands.addCommand(CommandIDs.redo, {
    label: trans.__('Redo'),
    isEnabled: () => {
      return tracker.currentWidget
        ? tracker.currentWidget.context.model.sharedModel.editable
        : false;
    },
    execute: args => {
      const current = tracker.currentWidget;

      if (current) {
        return current.context.model.sharedModel.redo();
      }
    },
    icon: redoIcon
  });

  commands.addCommand(CommandIDs.undo, {
    label: trans.__('Undo'),
    isEnabled: () => {
      return tracker.currentWidget
        ? tracker.currentWidget.context.model.sharedModel.editable
        : false;
    },
    execute: args => {
      const current = tracker.currentWidget;

      if (current) {
        return current.context.model.sharedModel.undo();
      }
    },
    icon: undoIcon
  });

  commands.addCommand(CommandIDs.openLayerBrowser, {
    label: trans.__('Open Layer Browser'),
    isEnabled: () => {
      return tracker.currentWidget
        ? tracker.currentWidget.context.model.sharedModel.editable
        : false;
    },
    iconClass: 'fa fa-book-open',
    execute: Private.createLayerBrowser(
      tracker,
      layerBrowserRegistry,
      formSchemaRegistry
    )
  });

  commands.addCommand(CommandIDs.newGeoJSONLayer, {
    label: trans.__('New vector layer'),
    isEnabled: () => {
      return tracker.currentWidget
        ? tracker.currentWidget.context.model.sharedModel.editable
        : false;
    },
    iconClass: 'fa fa-vector-square',
    execute: Private.createGeoJSONLayer(tracker, formSchemaRegistry)
  });

  commands.addCommand(CommandIDs.newVectorLayer, {
    label: trans.__('New vector layer'),
    isEnabled: () => {
      return tracker.currentWidget
        ? tracker.currentWidget.context.model.sharedModel.editable
        : false;
    },
    iconClass: 'fa fa-vector-square',
    execute: Private.createVectorLayer(tracker)
  });

  commands.addCommand(CommandIDs.newGeoJSONSource, {
    label: trans.__('Add GeoJSON data from file'),
    isEnabled: () => {
      return tracker.currentWidget
        ? tracker.currentWidget.context.model.sharedModel.editable
        : false;
    },
    icon: geoJSONIcon,
    execute: Private.createGeoJSONSource(tracker)
  });
}

namespace Private {
  export const FORM_SCHEMA = {};

  export function updateFormSchema(
    formSchemaRegistry: IJGISFormSchemaRegistry
  ) {
    if (Object.keys(FORM_SCHEMA).length > 0) {
      return;
    }
    const formSchema = formSchemaRegistry.getSchemas();
    formSchema.forEach((val, key) => {
      const value = (FORM_SCHEMA[key] = JSON.parse(JSON.stringify(val)));
      value['required'] = ['name', ...value['required']];
      value['properties'] = {
        name: { type: 'string', description: 'The name of the layer/source' },
        ...value['properties']
      };
    });
  }

  export function createLayerBrowser(
    tracker: WidgetTracker<JupyterGISWidget>,
    layerBrowserRegistry: IJGISLayerBrowserRegistry,
    formSchemaRegistry: IJGISFormSchemaRegistry
  ) {
    return async () => {
      const current = tracker.currentWidget;

      if (!current) {
        return;
      }

      const dialog = new LayerBrowserWidget({
        model: current.context.model,
        registry: layerBrowserRegistry.getRegistryLayers(),
        formSchemaRegistry
      });
      await dialog.launch();
    };
  }

  /**
   * Command to create a GeoJSON source and vector layer.
   */
  export function createGeoJSONLayer(
    tracker: WidgetTracker<JupyterGISWidget>,
    formSchemaRegistry: IJGISFormSchemaRegistry
  ) {
    return async () => {
      const current = tracker.currentWidget;

      if (!current) {
        return;
      }

      const dialog = new GeoJSONLayerDialog({
        model: current.context.model,
        registry: formSchemaRegistry
      });
      await dialog.launch();
    };
  }

  /**
   * Command to create a GeoJSON source.
   *
   * This is currently not used.
   */
  export function createGeoJSONSource(
    tracker: WidgetTracker<JupyterGISWidget>
  ) {
    const ajv = new Ajv();
    const validate = ajv.compile(geojson);

    return async (args: any) => {
      const current = tracker.currentWidget;

      if (!current) {
        return;
      }

      let filepath: string | null = (args.path as string) ?? null;
      let saveDataInShared: boolean = args.path ?? false;

      if (filepath === null) {
        const dialog = new Dialog({
          title: 'Path of the GeoJSON file',
          body: new DialogAddDataSourceBody()
        });
        const value = (await dialog.launch()).value;
        if (value) {
          filepath = value.path;
          saveDataInShared = value.saveDataInShared;
        }
      }

      if (!filepath) {
        return;
      }

      current.context.model
        .readGeoJSON(filepath)
        .then(async geoJSONData => {
          const name = PathExt.basename(filepath, '.json');
          const valid = validate(geoJSONData);
          if (!valid) {
            const dialog = new DataErrorDialog({
              title: 'GeoJSON data invalid',
              errors: validate.errors,
              saveDataInShared
            });
            const toContinue = await dialog.launch();
            if (!toContinue.button.accept || saveDataInShared) {
              return;
            }
          }

          const parameters: IGeoJSONSource = {};
          if (saveDataInShared) {
            parameters.data = geoJSONData;
          } else {
            (parameters.path = filepath), (parameters.valid = valid);
          }

          const sourceModel: IJGISSource = {
            type: 'GeoJSONSource',
            name,
            parameters
          };

          current.context.model.sharedModel.addSource(
            UUID.uuid4(),
            sourceModel
          );
        })
        .catch(e => {
          showErrorMessage('Error opening GeoJSON file', e);
          return;
        });
    };
  }

  /**
   * Command to create a Vector layer.
   *
   * This is currently not used.
   */
  export function createVectorLayer(tracker: WidgetTracker<JupyterGISWidget>) {
    return async (arg: any) => {
      const current = tracker.currentWidget;

      if (!current) {
        return;
      }

      const sources = current.context.model.getSourcesByType('GeoJSONSource');

      const form = {
        title: 'Vector Layer parameters',
        default: (model: IJupyterGISModel) => {
          return {
            name: 'VectorSource',
            source: Object.keys(sources)[0] ?? null
          };
        }
      };

      FORM_SCHEMA['VectorLayer'].properties.source.enumNames =
        Object.values(sources);
      FORM_SCHEMA['VectorLayer'].properties.source.enum = Object.keys(sources);
      const dialog = new FormDialog({
        context: current.context,
        title: form.title,
        sourceData: form.default(current.context.model),
        schema: FORM_SCHEMA['VectorLayer'],
        syncData: (props: IDict) => {
          const sharedModel = current.context.model.sharedModel;
          if (!sharedModel) {
            return;
          }

          const { name, ...parameters } = props;

          const layerModel: IJGISLayer = {
            type: 'VectorLayer',
            parameters: {
              source: parameters.source,
              type: parameters.type,
              color: parameters.color,
              opacity: parameters.opacity
            },
            visible: true,
            name: name + ' Layer'
          };

          current.context.model.addLayer(UUID.uuid4(), layerModel);
        }
      });
      await dialog.launch();
    };
  }
}

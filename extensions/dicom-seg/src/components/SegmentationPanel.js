import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import cornerstoneTools from 'cornerstone-tools';
import cornerstone from 'cornerstone-core';
import moment from 'moment';

import { utils } from '@ohif/core';
import { ScrollableArea, TableList, Icon } from '@ohif/ui';

import {
  BrushColorSelector,
  BrushRadius,
  SegmentationItem,
  SegmentItem,
  SegmentationSelect,
} from './index';

import './SegmentationPanel.css';
import SegmentationSettings from './SegmentationSettings';

const { studyMetadataManager } = utils;

const segmentationModule = cornerstoneTools.getModule('segmentation');
const DEFAULT_BRUSH_RADIUS = segmentationModule.getters.radius || 10;

const refreshViewport = () => {
  cornerstone.getEnabledElements().forEach(enabledElement => {
    cornerstone.updateImage(enabledElement.element);
  });
};

/**
 * SegmentationPanel component
 *
 * @param {Object} props
 * @param {Array} props.studies
 * @param {Array} props.viewports - viewportSpecificData
 * @param {number} props.activeIndex - activeViewportIndex
 * @returns component
 */
const SegmentationPanel = ({ studies, viewports, activeIndex }) => {
  /* TODO: This technically defaults to 10 if undefined (bug?) */
  const [brushRadius, setBrushRadius] = useState(DEFAULT_BRUSH_RADIUS);
  const [brushColor, setBrushColor] = useState('rgba(221, 85, 85, 1)');
  const [selectedSegment, setSelectedSegment] = useState();
  const [showSegSettings, setShowSegSettings] = useState(false);
  const [selectedSegmentation, setSelectedSegmentation] = useState();

  const viewport = viewports[activeIndex];
  const firstImageId = _getFirstImageId(viewport);
  const { studyInstanceUid, seriesInstanceUid } = viewport;

  /* CornerstoneTools */
  const [brushStackState, setBrushStackState] = useState(
    segmentationModule.state.series[firstImageId]
  );

  useEffect(() => {
    setBrushStackState(segmentationModule.state.series[firstImageId]);
  }, [studies, viewports, activeIndex, firstImageId]);

  useEffect(() => {
    if (brushStackState) {
      setSelectedSegmentation(brushStackState.activeLabelmapIndex);
    }

    const labelmapModifiedHandler = event => {
      console.warn('labelmap modified', event);
      setBrushStackState(segmentationModule.state.series[firstImageId]);
    };

    /*
     * These are specific to each element;
     * Need to iterate cornerstone-tools tracked enabled elements?
     * Then only care about the one tied to active viewport?
     */
    cornerstoneTools.store.state.enabledElements.forEach(enabledElement =>
      enabledElement.addEventListener(
        'cornersontetoolslabelmapmodified',
        labelmapModifiedHandler
      )
    );

    document.addEventListener('side-panel-change', handleSidePanelChange);

    return () => {
      cornerstoneTools.store.state.enabledElements.forEach(enabledElement =>
        enabledElement.removeEventListener(
          'cornersontetoolslabelmapmodified',
          labelmapModifiedHandler
        )
      );

      document.removeEventListener('side-panel-change', handleSidePanelChange);
    };
  });

  const handleSidePanelChange = () => {
    setShowSegSettings(false);
  };

  if (!brushStackState) {
    return null;
  }

  const labelmap3D =
    brushStackState.labelmaps3D[brushStackState.activeLabelmapIndex];

  /*
   * 2. UseEffect to update state? or to a least trigger a re-render
   * 4. Toggle visibility of labelmap?
   * 5. Toggle visibility of seg?
   *
   * If the port is cornerstone, just need to call a re-render.
   * If the port is vtkjs, its a bit more tricky as we now need to create a new
   */

  const getLabelmapList = () => {
    /* Get list of SEG labelmaps specific to active viewport (reference series) */
    const referencedSegDisplaysets = _getReferencedSegDisplaysets(
      studyInstanceUid,
      seriesInstanceUid
    );

    return referencedSegDisplaysets.map((displaySet, index) => {
      const { labelmapIndex, seriesDate, seriesTime } = displaySet;

      /* Map to display representation */
      const dateStr = `${seriesDate}:${seriesTime}`.split('.')[0];
      const date = moment(dateStr, 'YYYYMMDD:HHmmss');
      const isActiveLabelmap =
        labelmapIndex === brushStackState.activeLabelmapIndex;
      const displayDate = date.format('ddd, MMM Do YYYY');
      const displayTime = date.format('h:mm:ss a');
      const displayDescription = displaySet.seriesDescription;

      return {
        value: labelmapIndex,
        title: displayDescription,
        description: displayDate,
        onClick: async () => {
          const activatedLabelmapIndex = await _setActiveLabelmap(
            viewport,
            studies,
            displaySet,
            firstImageId,
            brushStackState.activeLabelmapIndex
          );
          setSelectedSegmentation(activatedLabelmapIndex);
        },
      };
    });
  };

  const labelmapList = getLabelmapList();

  const segmentList = [];

  if (labelmap3D) {
    /*
     * Newly created segments have no `meta`
     * So we instead build a list of all segment indexes in use
     * Then find any associated metadata
     */
    const uniqueSegmentIndexes = labelmap3D.labelmaps2D
      .reduce((acc, labelmap2D) => {
        if (labelmap2D) {
          const segmentIndexes = labelmap2D.segmentsOnLabelmap;

          for (let i = 0; i < segmentIndexes.length; i++) {
            if (!acc.includes(segmentIndexes[i]) && segmentIndexes[i] !== 0) {
              acc.push(segmentIndexes[i]);
            }
          }
        }

        return acc;
      }, [])
      .sort((a, b) => a - b);

    const colorLutTable =
      segmentationModule.state.colorLutTables[labelmap3D.colorLUTIndex];
    const hasLabelmapMeta = labelmap3D.metadata && labelmap3D.metadata.data;

    for (let i = 0; i < uniqueSegmentIndexes.length; i++) {
      const segmentIndex = uniqueSegmentIndexes[i];

      const color = colorLutTable[segmentIndex];
      let segmentLabel = '(unlabeled)';
      let segmentNumber = segmentIndex;

      /* Meta */
      if (hasLabelmapMeta) {
        const segmentMeta = labelmap3D.metadata.data[segmentIndex];

        if (segmentMeta) {
          segmentNumber = segmentMeta.SegmentNumber;
          segmentLabel = segmentMeta.SegmentLabel;
        }
      }

      const sameSegment = selectedSegment === segmentNumber;
      const setCurrentSelectedSegment = () => {
        _setActiveSegment(firstImageId, segmentNumber, labelmap3D.activeSegmentIndex);
        setSelectedSegment(sameSegment ? null : segmentNumber);
      };

      segmentList.push(
        <SegmentItem
          key={segmentNumber}
          itemClass={`segment-item ${sameSegment && 'selected'}`}
          onClick={setCurrentSelectedSegment}
          label={segmentLabel}
          index={segmentNumber}
          color={color}
        />
      );
    }

    /*
     * Let's iterate over segmentIndexes ^ above
     * If meta has a match, use it to show info
     * If now, add "no-meta" class
     * Show default name
     */
  }

  const updateBrushSize = evt => {
    const updatedRadius = Number(evt.target.value);

    if (updatedRadius !== brushRadius) {
      setBrushRadius(updatedRadius);
      segmentationModule.setters.radius(updatedRadius);
    }
  };

  const decrementSegment = event => {
    event.preventDefault();
    if (labelmap3D.activeSegmentIndex > 1) {
      labelmap3D.activeSegmentIndex--;
    }
    setActiveSegmentColor();
  };

  const incrementSegment = event => {
    event.preventDefault();
    labelmap3D.activeSegmentIndex++;
    setActiveSegmentColor();
  };

  const setActiveSegmentColor = () => {
    const color = getActiveSegmentColor();
    setBrushColor(color);
  };

  const getActiveSegmentColor = () => {
    if (!brushStackState) {
      return 'rgba(255, 255, 255, 1)';
    }

    const colorLutTable =
      segmentationModule.state.colorLutTables[labelmap3D.colorLUTIndex];
    const color = colorLutTable[labelmap3D.activeSegmentIndex];

    return `rgba(${color.join(',')})`;
  };

  const updateConfiguration = newConfiguration => {
    /* Supported configuration */
    configuration.renderFill = newConfiguration.renderFill;
    configuration.renderOutline = newConfiguration.renderOutline;
    configuration.shouldRenderInactiveLabelmaps = newConfiguration.shouldRenderInactiveLabelmaps;
    configuration.fillAlpha = newConfiguration.fillAlpha;
    configuration.outlineAlpha = newConfiguration.outlineAlpha;
    configuration.outlineWidth = newConfiguration.outlineWidth;
    configuration.fillAlphaInactive = newConfiguration.fillAlphaInactive;
    configuration.outlineAlphaInactive = newConfiguration.outlineAlphaInactive;
    refreshViewport();
  };

  const { configuration } = segmentationModule;

  if (showSegSettings) {
    return (
      <SegmentationSettings
        configuration={configuration}
        onBack={() => setShowSegSettings(false)}
        onChange={updateConfiguration}
      />
    );
  } else {
    return (
      <div className="labelmap-container">
        <Icon
          className="cog-icon"
          name="cog"
          width="25px"
          height="25px"
          onClick={() => setShowSegSettings(true)}
        />
        {false && (
          <form className="selector-form">
            <BrushColorSelector
              defaultColor={brushColor}
              index={labelmap3D.activeSegmentIndex}
              onNext={incrementSegment}
              onPrev={decrementSegment}
            />
            <BrushRadius value={brushRadius} onChange={updateBrushSize} />
          </form>
        )}
        <h3>Segmentations</h3>
        <div className="segmentations">
          <SegmentationSelect
            value={labelmapList.find(i => i.value === selectedSegmentation) || null}
            formatOptionLabel={SegmentationItem}
            options={labelmapList}
          />
        </div>
        <ScrollableArea>
          <TableList customHeader={<SegmentsHeader count={segmentList.length} />}>
            {segmentList}
          </TableList>
        </ScrollableArea>
      </div>
    );
  }
};

SegmentationPanel.propTypes = {
  /*
   * An object, with int index keys?
   * Maps to: state.viewports.viewportSpecificData, in `viewer`
   * Passed in MODULE_TYPES.PANEL when specifying component in viewer
   */
  viewports: PropTypes.shape({
    displaySetInstanceUid: PropTypes.string,
    framRate: PropTypes.any,
    instanceNumber: PropTypes.number,
    isMultiFrame: PropTypes.bool,
    isReconstructable: PropTypes.bool,
    modality: PropTypes.string,
    plugin: PropTypes.string,
    seriesDate: PropTypes.string,
    seriesDescription: PropTypes.string,
    seriesInstanceUid: PropTypes.string,
    seriesNumber: PropTypes.any,
    seriesTime: PropTypes.string,
    sopClassUids: PropTypes.arrayOf(PropTypes.string),
    studyInstanceUid: PropTypes.string,
  }),
  activeIndex: PropTypes.number.isRequired,
  studies: PropTypes.array.isRequired,
};
SegmentationPanel.defaultProps = {};

const _getFirstImageId = ({ studyInstanceUid, displaySetInstanceUid }) => {
  try {
    const studyMetadata = studyMetadataManager.get(studyInstanceUid);
    const displaySet = studyMetadata.findDisplaySet(
      displaySet => displaySet.displaySetInstanceUid === displaySetInstanceUid
    );
    return displaySet.images[0].getImageId();
  } catch (error) {
    console.error('Failed to retrieve image metadata');
    return null;
  }
};

/**
 * Returns SEG Displaysets that reference the target series, sorted by dateTime
 *
 * @param {string} studyInstanceUid
 * @param {string} seriesInstanceUid
 * @returns Array
 */
const _getReferencedSegDisplaysets = (studyInstanceUid, seriesInstanceUid) => {
  /* Referenced DisplaySets */
  const studyMetadata = studyMetadataManager.get(studyInstanceUid);
  const referencedDisplaysets = studyMetadata.getDerivedDatasets({
    referencedSeriesInstanceUID: seriesInstanceUid,
    modality: 'SEG',
  });

  /* Sort */
  referencedDisplaysets.sort((a, b) => {
    const aNumber = Number(`${a.seriesDate}${a.seriesTime}`);
    const bNumber = Number(`${b.seriesDate}${b.seriesTime}`);
    return aNumber - bNumber;
  });

  return referencedDisplaysets;
};

/**
 *
 *
 * @param {*} viewportSpecificData
 * @param {*} studies
 * @param {*} displaySet
 * @param {*} firstImageId
 * @param {*} activeLabelmapIndex
 * @returns
 */
const _setActiveLabelmap = async (
  viewportSpecificData,
  studies,
  displaySet,
  firstImageId,
  activeLabelmapIndex
) => {
  if (displaySet.labelmapIndex === activeLabelmapIndex) {
    console.warn(`${activeLabelmapIndex} is already the active labelmap`);
    return;
  }

  if (!displaySet.isLoaded) {
    // What props does this expect `viewportSpecificData` to have?
    // TODO: Should this return the `labelmapIndex`?
    await displaySet.load(viewportSpecificData, studies);
  }

  const { state } = cornerstoneTools.getModule('segmentation');
  const brushStackState = state.series[firstImageId];

  brushStackState.activeLabelmapIndex = displaySet.labelmapIndex;

  refreshViewport();

  return displaySet.labelmapIndex;
};

/**
 *
 * @param {*} firstImageId
 * @param {*} activeSegmentIndex
 * @returns
 */
const _setActiveSegment = (firstImageId, segmentIndex, activeSegmentIndex) => {
  if (segmentIndex === activeSegmentIndex) {
    console.warn(`${activeSegmentIndex} is already the active segment`);
    return;
  }

  const { state } = cornerstoneTools.getModule('segmentation');
  const brushStackState = state.series[firstImageId];

  const labelmap3D =
    brushStackState.labelmaps3D[brushStackState.activeLabelmapIndex];
  labelmap3D.activeSegmentIndex = segmentIndex;

  refreshViewport();

  return segmentIndex;
};

const SegmentsHeader = ({ count }) => {
  return (
    <React.Fragment>
      <div className="tableListHeaderTitle">Segments</div>
      <div className="numberOfItems">{count}</div>
    </React.Fragment>
  );
};

export default SegmentationPanel;
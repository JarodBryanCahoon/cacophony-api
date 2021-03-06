const { body } = require('express-validator/check');

const log = require('../../logging');
const middleware = require('../middleware');
const models = require('../../models');
const recordingUtil = require('../V1/recordingUtil');
const uuidv4 = require('uuid/v4');


module.exports = function(app) {
  var apiUrl = '/api/fileProcessing';

  /**
   * @api {get} /api/fileProcessing Get a new file processing job
   * @apiName getNewFileProcessingJob
   * @apiGroup FileProcessing
   *
   * @apiParam {String} type Type of recording.
   * @apiParam {String} state Processing state.
   */
  app.get(apiUrl, async (request, response) => {
    log.info(request.method + " Request: " + request.url);

    var type = request.query.type;
    var state = request.query.state;

    var recording = await models.Recording.findOne({
      where: {
        'type': type,
        'processingState': state,
        'processingStartTime': null,
      },
      attributes: models.Recording.processingAttributes,
      // Process the most recent footage first. This helps when we're
      // re-processing a backlog of old recordings but still want to
      // have new recordings processed as they come in.
      order: [['recordingDateTime', 'DESC']],
    });
    if (recording == null) {
      log.debug('No file to be processed.');
      return response.status(204).json();
    }

    await recording.set('jobKey', uuidv4());
    var date = new Date();
    await recording.set('processingStartTime', date.toISOString());
    await recording.save();
    return response.status(200).json({
      recording: recording.dataValues,
    });
  });

  /**
   * @api {put} /api/fileProcessing Finished a file processing job
   * @apiName finishedFileProcessingJob
   * @apiGroup FileProcessing
   *
   * @apiParam {Integer} id ID of the recording.
   * @apiParam {String} jobKey Key given when reqesting the job.
   * @apiParam {Boolean} success If the job was finished successfully.
   * @apiParam {JSON} [result] Result of the file processing
   * @apiParam {String} [newProcessedFileKey] LeoFS Key of the new file.
   */
  app.put(apiUrl, async (request, response) => {
    log.info(request.method + " Request: " + request.url);

    var id = parseInt(request.body.id);
    var jobKey = request.body.jobKey;
    var success = request.body.success;
    var result = request.body.result;
    var newProcessedFileKey = request.body.newProcessedFileKey;

    // Validate request.
    var errorMessages = [];
    if (isNaN(id)) {
      errorMessages.push("'id' field needs to be a number.");
    }
    if (jobKey == null) {
      errorMessages.push("'jobKey' field is required.");
    }
    if (success == null) {
      errorMessages.push("'success' field is required");
    }
    if (result != null) {
      try {
        result = JSON.parse(result);
      } catch (e) {
        errorMessages.push("'result' field was not a valid JSON.");
      }
    }
    if (errorMessages.length > 0) {
      return response.status(400).json({
        messages: errorMessages,
      });
    }

    var recording = await models.Recording.findOne({ where: { id: id }});

    // Check that jobKey is correct.
    if (jobKey != recording.get('jobKey')) {
      return response.status(400).json({
        messages: ["'jobKey' given did not match the database.."],
      });
    }

    if (success) {
      var jobs = models.Recording.processingStates[recording.type];
      var nextJob = jobs[jobs.indexOf(recording.processingState)+1];
      recording.set('processingState', nextJob);
      recording.set('processingStartTime', null);
      recording.set('fileKey', newProcessedFileKey);
      recording.set('jobKey', null);

      // Process extra data from file processing
      if (result.fieldUpdates != null) {
        for (var i in result.fieldUpdates) {
          recording.set(i, result.fieldUpdates[i]);
        }
      }

      await recording.save();
      return response.status(200).json({messages: ["Processing finished."]});
    } else {
      recording.set('processingStartTime', null);
      recording.set('jobKey', null);
      await recording.save();
      return response.status(200).json({
        messages: ["Processing failed."],
      });
    }
  });

  /**
   * @api {post} /api/fileProcessing/tags Add a tag to a recording
   * @apiName tagRecordingAfterFileProcessing
   * @apiGroup FileProcessing
   *
   * @apiDescription This call takes a `tag` field which contains a JSON
   * object string containing a number of fields. See /api/V1/tags for
   * more details.
   *
   * @apiParam {Number} recordingId ID of the recording that you want to tag.
   * @apiparam {JSON} tag Tag data in JSON format.
   *
   * @apiUse V1ResponseSuccess
   * @apiSuccess {Number} tagId ID of the tag just added.
   *
   * @apiuse V1ResponseError
   *
   */
  app.post(
    apiUrl + "/tags",
    [
      middleware.parseJSON('tag', body),
      body('recordingId').isInt(),
    ],
    middleware.requestWrapper(async (request, response) => {
      recordingUtil.addTag(request, response);
    })
  );
};

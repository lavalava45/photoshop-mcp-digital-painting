const { action, core } = require('photoshop');

const READ_OPTIONS = {
  synchronousExecution: true,
  modalBehavior: 'fail',
};

function numericValue(value) {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && typeof value._value === 'number') return value._value;
  if (value && typeof value === 'object' && typeof value.value === 'number') return value.value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function getNumberOfDocumentsDescriptor() {
  return {
    _obj: 'get',
    _target: [
      { _property: 'numberOfDocuments' },
      { _ref: 'application', _enum: 'ordinal', _value: 'targetEnum' },
    ],
    _options: { dialogOptions: 'dontDisplay' },
  };
}

function documentInfoDescriptor(index) {
  return {
    _obj: 'multiGet',
    _target: {
      _ref: [{ _ref: 'document', _index: index }],
    },
    extendedReference: [['documentID', 'title']],
    options: { failOnMissingProperty: false, failOnMissingElement: false },
    _options: { dialogOptions: 'dontDisplay' },
  };
}

function activeDocumentInfoDescriptor() {
  return {
    _obj: 'multiGet',
    _target: {
      _ref: [{ _ref: 'document', _enum: 'ordinal', _value: 'targetEnum' }],
    },
    extendedReference: [['documentID', 'title']],
    options: { failOnMissingProperty: false, failOnMissingElement: false },
    _options: { dialogOptions: 'dontDisplay' },
  };
}

async function listOpenDocuments() {
  const [countDescriptor] = await action.batchPlay(
    [getNumberOfDocumentsDescriptor()],
    READ_OPTIONS
  );
  const count = numericValue(countDescriptor?.numberOfDocuments) ?? 0;
  if (count <= 0) return [];

  const descriptors = await action.batchPlay(
    Array.from({ length: count }, (_, index) => documentInfoDescriptor(index + 1)),
    READ_OPTIONS
  );
  return descriptors.map((descriptor, index) => ({
    id: numericValue(descriptor?.documentID),
    name: typeof descriptor?.title === 'string' ? descriptor.title : '',
    index,
  }));
}

async function readActiveDocumentContext() {
  const [descriptor] = await action.batchPlay([activeDocumentInfoDescriptor()], READ_OPTIONS);
  const id = numericValue(descriptor?.documentID);
  const name = typeof descriptor?.title === 'string' ? descriptor.title : '';
  return {
    hasDocument: Number.isInteger(id) && id > 0,
    ...(Number.isInteger(id) && id > 0
      ? { document: { id, name } }
      : {}),
  };
}

function documentNotFound(message) {
  return {
    handled: true,
    data: {
      ok: false,
      code: 'document_not_found',
      message,
    },
  };
}

async function setActiveDocument(params = {}) {
  const hasId = params.document_id !== undefined && params.document_id !== null;
  const hasIndex = params.index !== undefined && params.index !== null;
  const hasName = typeof params.document_name === 'string' && params.document_name.length > 0;
  if ([hasId, hasIndex, hasName].filter(Boolean).length !== 1) {
    throw new Error(
      'Exactly one of document_id, index, or document_name is required to set the active document'
    );
  }

  const documents = await listOpenDocuments();
  let target = null;

  if (hasId) {
    const documentId = Number(params.document_id);
    target = documents.find((document) => document.id === documentId) ?? null;
    if (!target) return documentNotFound(`No open document with id ${params.document_id}`);
  } else if (hasIndex) {
    const index = Number(params.index);
    if (!Number.isInteger(index) || index < 0 || index >= documents.length) {
      return documentNotFound(
        `Document index out of range: ${params.index} (open count: ${documents.length})`
      );
    }
    target = documents[index];
  } else {
    const matches = documents.filter((document) => document.name === params.document_name);
    if (matches.length === 0) {
      return documentNotFound(`No open document named \"${params.document_name}\"`);
    }
    if (matches.length > 1) {
      return {
        handled: true,
        data: {
          ok: false,
          code: 'ambiguous_name',
          message: `Multiple open documents named \"${params.document_name}\". Use document_id instead.`,
          matching_document_ids: matches
            .map((document) => document.id)
            .filter((id) => Number.isInteger(id) && id > 0),
        },
      };
    }
    target = matches[0];
  }

  if (!Number.isInteger(target?.id) || target.id <= 0) {
    return documentNotFound('Target document id is unavailable');
  }

  await core.executeAsModal(
    async () => {
      await action.batchPlay(
        [
          {
            _obj: 'select',
            _target: [{ _ref: 'document', _id: target.id }],
            _options: { dialogOptions: 'dontDisplay' },
          },
        ],
        { synchronousExecution: true }
      );
    },
    { commandName: 'MCP Set Active Document' }
  );

  const context = await readActiveDocumentContext();
  return {
    handled: true,
    data: {
      ok: true,
      activated: { id: target.id, name: target.name },
      context,
    },
  };
}

async function closeDocument(params = {}) {
  const documents = await listOpenDocuments();
  if (documents.length === 0) throw new Error('No active document');

  const requestedDocumentId =
    Number.isInteger(params.document_id) && params.document_id > 0
      ? params.document_id
      : null;
  if (requestedDocumentId !== null && !documents.some((document) => document.id === requestedDocumentId)) {
    return documentNotFound(`No open document with id ${requestedDocumentId}`);
  }
  const save = params.save === true;
  const target = requestedDocumentId !== null
    ? [{ _ref: 'document', _id: requestedDocumentId }]
    : [{ _ref: 'document', _enum: 'ordinal', _value: 'targetEnum' }];

  await core.executeAsModal(
    async () => {
      if (requestedDocumentId !== null) {
        const [descriptor] = await action.batchPlay(
          [activeDocumentInfoDescriptor()],
          { synchronousExecution: true }
        );
        const activeDocumentId = numericValue(descriptor?.documentID);
        if (activeDocumentId !== requestedDocumentId) {
          throw new Error(
            `document_not_active: pinned document ${requestedDocumentId} is open but not active; active document was not changed`
          );
        }
      }
      await action.batchPlay(
        [
          {
            _obj: 'close',
            _target: target,
            saving: { _enum: 'yesNo', _value: save ? 'yes' : 'no' },
            _options: { dialogOptions: 'dontDisplay' },
          },
        ],
        { synchronousExecution: true }
      );
    },
    { commandName: save ? 'MCP Close Document and Save' : 'MCP Close Document' }
  );

  return {
    handled: true,
    data: {
      ok: true,
      closed: true,
      saved: save,
      ...(requestedDocumentId !== null ? { document_id: requestedDocumentId } : {}),
    },
  };
}

async function tryHandleP1DocumentOperation(cmdAction, params = {}) {
  if (cmdAction === 'set_active_document') return setActiveDocument(params);
  if (cmdAction === 'close_document') return closeDocument(params);
  return { handled: false };
}

module.exports = { tryHandleP1DocumentOperation };

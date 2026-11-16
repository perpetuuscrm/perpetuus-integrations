'use strict';

const { createClient } = require('../lib/client');
const { upsertContact } = require('../lib/operations');
const samples = require('../lib/samples');

const perform = (z, bundle) => {
  const input = bundle.inputData;
  return upsertContact(createClient(z), {
    email: input.email,
    phone: input.phone,
    name: input.name,
    matchBy: input.matchBy,
    contactType: input.contactType,
    cpf: input.cpf,
    cnpj: input.cnpj,
    address: input.address,
    city: input.city,
    state: input.state,
    country: input.country,
    postalCode: input.postalCode,
    customFields: input.customFields,
  });
};

module.exports = {
  key: 'upsertContact',
  noun: 'Contact',
  display: {
    label: 'Create or Update Contact',
    description:
      'Creates a new contact or updates the existing one with the same email or phone.',
  },
  operation: {
    inputFields: [
      {
        key: 'email',
        label: 'Email',
        type: 'string',
        required: false,
        helpText: 'Used to find an existing contact. Provide an email, a phone, or both.',
      },
      {
        key: 'phone',
        label: 'Phone',
        type: 'string',
        required: false,
        helpText:
          'Any Brazilian format, such as (11) 99999-0000 or +55 11 99999-0000. It is saved in E.164.',
      },
      {
        key: 'name',
        label: 'Name',
        type: 'string',
        required: false,
        helpText: 'Full name or company name. Required when the contact does not exist yet.',
      },
      {
        key: 'matchBy',
        label: 'Match By',
        required: false,
        list: true,
        choices: [
          { value: 'email', label: 'Email', sample: 'email' },
          { value: 'phone', label: 'Phone', sample: 'phone' },
        ],
        helpText:
          'Which values identify an existing contact. Leave empty to match by email and phone.',
      },
      {
        key: 'contactType',
        label: 'Contact Type',
        required: false,
        choices: [
          { value: 'person', label: 'Person', sample: 'person' },
          { value: 'company', label: 'Company', sample: 'company' },
        ],
        helpText: 'Whether the contact is a person or a company.',
      },
      { key: 'cpf', label: 'CPF', type: 'string', required: false, helpText: 'Brazilian individual taxpayer ID.' },
      { key: 'cnpj', label: 'CNPJ', type: 'string', required: false, helpText: 'Brazilian company taxpayer ID.' },
      { key: 'address', label: 'Address', type: 'string', required: false, helpText: 'Street and number.' },
      { key: 'city', label: 'City', type: 'string', required: false, helpText: 'City of the address.' },
      { key: 'state', label: 'State', type: 'string', required: false, helpText: 'State of the address, such as SP.' },
      { key: 'country', label: 'Country', type: 'string', required: false, helpText: 'Country of the address.' },
      { key: 'postalCode', label: 'Postal Code', type: 'string', required: false, helpText: 'CEP or ZIP code.' },
      {
        key: 'customFields',
        label: 'Custom Fields',
        dict: true,
        required: false,
        helpText: 'Extra contact fields as key and value pairs, using the field key from Perpetuus.',
      },
    ],
    perform,
    sample: samples.upsertedContact,
    outputFields: samples.upsertedContactOutputFields,
  },
};

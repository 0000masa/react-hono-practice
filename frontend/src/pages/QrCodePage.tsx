import React from 'react';
import Layout from '../components/Layout';
import QrCodeGenerator from '../components/QrCodeGenerator';
import QrCodeList from '../components/QrCodeList';

const QrCodePage: React.FC = () => {
  return (
    <Layout>
      <QrCodeGenerator />
      <QrCodeList />
    </Layout>
  );
};

export default QrCodePage;

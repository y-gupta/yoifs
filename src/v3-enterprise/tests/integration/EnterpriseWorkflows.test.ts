import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { MemoryDisk } from '../../../v1-basic/index';
import { EnterpriseFileSystem } from '../../core/EnterpriseFileSystem';
import { createEnterpriseConfig } from '../../utils/ConfigFactory';

describe('Enterprise Workflows Integration Tests', () => {
  let disk: MemoryDisk;
  let fileSystem: EnterpriseFileSystem;
  let adminToken: string;
  let managerToken: string;
  let employeeToken: string;

  beforeEach(async () => {
    disk = new MemoryDisk(10 * 1024 * 1024); // 10MB
    const config = createEnterpriseConfig('production');
    fileSystem = new EnterpriseFileSystem(disk, config);
    
    // Setup test users
    const adminAuth = await fileSystem.authenticateUser({
      username: 'admin',
      password: 'admin123'
    });
    adminToken = adminAuth.sessionToken!;

    await fileSystem.createUser('manager', 'manager123', ['MANAGER']);
    await fileSystem.createUser('employee', 'employee123', ['EMPLOYEE']);

    const managerAuth = await fileSystem.authenticateUser({
      username: 'manager',
      password: 'manager123'
    });
    managerToken = managerAuth.sessionToken!;

    const employeeAuth = await fileSystem.authenticateUser({
      username: 'employee',
      password: 'employee123'
    });
    employeeToken = employeeAuth.sessionToken!;
  });

  afterEach(async () => {
    await fileSystem.shutdown();
  });

  describe('Healthcare Data Management Workflow', () => {
    it('should handle complete healthcare document lifecycle', async () => {
      // 1. Manager uploads patient records with high redundancy
      const patientData = Buffer.from(JSON.stringify({
        patientId: 'P-12345',
        name: 'John Doe',
        medicalHistory: 'Diabetes Type 2, managed with medication',
        diagnosis: 'Routine checkup - stable condition',
        lastVisit: '2024-01-15'
      }));

      const uploadResult = await fileSystem.writeFileWithRedundancy(
        managerToken,
        'patient-P-12345.json',
        patientData,
        'manager',
        5 // 5x redundancy for critical health data
      );
      
      expect(uploadResult.success).toBe(true);
      const patientFileId = uploadResult.data!;

      // 2. Employee tries to access patient data (should succeed based on role)
      const employeeReadResult = await fileSystem.readFile(employeeToken, patientFileId);
      expect(employeeReadResult.success).toBe(true);
      
      const retrievedData = JSON.parse(employeeReadResult.data!.toString());
      expect(retrievedData.patientId).toBe('P-12345');

      // 3. Manager updates patient record
      const updatedData = Buffer.from(JSON.stringify({
        ...JSON.parse(patientData.toString()),
        lastVisit: '2024-02-15',
        notes: 'Follow-up visit - condition improving'
      }));

      const updateResult = await fileSystem.writeFile(
        managerToken,
        'patient-P-12345-updated.json',
        updatedData,
        'manager'
      );
      expect(updateResult.success).toBe(true);

      // 4. Verify data integrity after critical operations
      const integrityResult = await fileSystem.verifyDataIntegrity(adminToken);
      expect(integrityResult.success).toBe(true);
      expect(integrityResult.data.corruptedFiles).toBe(0);

      // 5. Check security audit trail
      const securityEvents = fileSystem.getSecurityEvents(50);
      const fileAccessEvents = securityEvents.filter(e => 
        e.action.includes('FILE') || e.action.includes('READ') || e.action.includes('WRITE')
      );
      expect(fileAccessEvents.length).toBeGreaterThan(0);
    });

    it('should enforce HIPAA compliance requirements', async () => {
      // 1. Create sensitive health record
      const healthRecord = Buffer.from('CONFIDENTIAL: Patient mental health assessment');
      
      const writeResult = await fileSystem.writeFile(
        managerToken,
        'mental-health-assessment.txt',
        healthRecord,
        'manager'
      );
      expect(writeResult.success).toBe(true);

      // 2. Verify encryption is applied (data at rest protection)
      const encryptionStats = fileSystem.getEncryptionStats();
      expect(encryptionStats.activeKeys).toBeGreaterThan(0);

      // 3. Verify access logging (audit requirement)
      const readResult = await fileSystem.readFile(employeeToken, writeResult.data!);
      expect(readResult.success).toBe(true);

      const auditEvents = fileSystem.getSecurityEvents();
      const accessEvent = auditEvents.find(e => 
        e.action.includes('READ') && e.userId === 'employee'
      );
      expect(accessEvent).toBeDefined();

      // 4. Test data retention compliance
      const searchResult = await fileSystem.searchFiles(adminToken, {
        owner: 'manager',
        namePattern: 'mental-health'
      });
      expect(searchResult.success).toBe(true);
      expect(searchResult.data!.length).toBe(1);
    });
  });

  describe('Multi-User Collaborative Workflow', () => {
    it('should handle concurrent file operations safely', async () => {
      const documents = [
        { name: 'project-plan.md', content: Buffer.from('# Project Plan\nInitial draft') },
        { name: 'budget.xlsx', content: Buffer.from('Budget data spreadsheet content') },
        { name: 'timeline.txt', content: Buffer.from('Project timeline and milestones') }
      ];

      // Simulate concurrent uploads from different users
      const uploadPromises = documents.map(async (doc, index) => {
        const token = index % 2 === 0 ? managerToken : employeeToken;
        const owner = index % 2 === 0 ? 'manager' : 'employee';
        
        return await fileSystem.writeFile(token, doc.name, doc.content, owner);
      });

      const uploadResults = await Promise.all(uploadPromises);
      
      // All uploads should succeed
      uploadResults.forEach(result => {
        expect(result.success).toBe(true);
      });

      // Verify all files can be read back correctly
      const readPromises = uploadResults.map(async (result, index) => {
        const token = index % 2 === 0 ? managerToken : employeeToken;
        return await fileSystem.readFile(token, result.data!);
      });

      const readResults = await Promise.all(readPromises);
      
      readResults.forEach((readResult, index) => {
        expect(readResult.success).toBe(true);
        expect(Buffer.compare(readResult.data!, documents[index].content)).toBe(0);
      });
    });

    it('should maintain quota enforcement across users', async () => {
      // Set restrictive quotas for employee
      fileSystem.setUserQuota('employee', {
        storageLimit: 1000, // 1KB
        fileCountLimit: 3,
        bandwidthLimit: 5000,
        retentionPeriod: 365
      });

      const smallFile = Buffer.from('Small file content');
      const largeFile = Buffer.alloc(800, 'x'); // 800 bytes

      // Employee should be able to create small files within quota
      const result1 = await fileSystem.writeFile(employeeToken, 'small1.txt', smallFile, 'employee');
      expect(result1.success).toBe(true);

      const result2 = await fileSystem.writeFile(employeeToken, 'large1.txt', largeFile, 'employee');
      expect(result2.success).toBe(true);

      // This should exceed storage quota
      const result3 = await fileSystem.writeFile(employeeToken, 'large2.txt', largeFile, 'employee');
      expect(result3.success).toBe(false);

      // Manager should still be able to create files (different quota)
      const managerResult = await fileSystem.writeFile(managerToken, 'manager-file.txt', largeFile, 'manager');
      expect(managerResult.success).toBe(true);

      // Verify quota tracking
      const employeeUsage = fileSystem.getUserUsage('employee');
      expect(employeeUsage!.fileCount).toBe(2);
      expect(employeeUsage!.storageUsed).toBeGreaterThan(0);
    });
  });

  describe('Disaster Recovery Workflow', () => {
    it('should recover from massive corruption with minimal data loss', async () => {
      // 1. Create critical business documents with high redundancy
      const criticalDocs = [
        'financial-report-q4.pdf',
        'employee-database.json',
        'customer-contracts.doc',
        'intellectual-property.txt',
        'compliance-audit.xlsx'
      ];

      const fileIds: string[] = [];
      
      for (const docName of criticalDocs) {
        const content = Buffer.from(`Critical business data for ${docName}`);
        const result = await fileSystem.writeFileWithRedundancy(
          managerToken,
          docName,
          content,
          'manager',
          7 // 7x redundancy for critical data
        );
        expect(result.success).toBe(true);
        fileIds.push(result.data!);
      }

      // 2. Simulate catastrophic disk corruption (50% of disk corrupted)
      const corruptionSize = Math.floor(disk.getSize() * 0.5);
      const corruptionData = Buffer.alloc(corruptionSize, 0xFF);
      
      // Corrupt random locations
      for (let i = 0; i < 10; i++) {
        const randomOffset = Math.floor(Math.random() * (disk.getSize() - corruptionSize));
        await disk.write(randomOffset, corruptionData.subarray(0, Math.floor(corruptionSize / 10)));
      }

      // 3. Attempt to recover all critical files
      const recoveryResults = [];
      
      for (const fileId of fileIds) {
        const result = await fileSystem.readFile(adminToken, fileId, {
          allowPartialRecovery: true,
          fillCorruptedChunks: 'zeros',
          minimumRecoveryRate: 20 // Accept 20% recovery rate for disaster scenarios
        });
        
        recoveryResults.push({
          fileId,
          success: result.success,
          corruptionReport: result.corruptionReport
        });
      }

      // 4. Verify recovery statistics
      const successfulRecoveries = recoveryResults.filter(r => r.success);
      const recoveryRate = (successfulRecoveries.length / fileIds.length) * 100;
      
      // Should recover at least 60% of files due to high redundancy
      expect(recoveryRate).toBeGreaterThanOrEqual(60);

      // 5. Generate disaster recovery report
      const healthReport = fileSystem.getSystemHealthReport();
      expect(healthReport.corruption.detectedCorruptions).toBeGreaterThan(0);
      
      console.log('Disaster Recovery Summary:', {
        totalFiles: fileIds.length,
        successfulRecoveries: successfulRecoveries.length,
        recoveryRate: `${recoveryRate.toFixed(1)}%`,
        corruptionDetected: healthReport.corruption.detectedCorruptions,
        systemHealthScore: healthReport.corruption.healthScore
      });
    });
  });

  describe('Performance Under Load Workflow', () => {
    it('should maintain performance with high concurrent load', async () => {
      const startTime = Date.now();
      const fileOperations = [];
      
      // Simulate 50 concurrent file operations
      for (let i = 0; i < 50; i++) {
        const content = Buffer.from(`Load test file ${i} - ${new Date().toISOString()}`);
        const token = i % 3 === 0 ? adminToken : (i % 3 === 1 ? managerToken : employeeToken);
        const owner = i % 3 === 0 ? 'admin' : (i % 3 === 1 ? 'manager' : 'employee');
        
        fileOperations.push(
          fileSystem.writeFile(token, `loadtest-${i}.txt`, content, owner)
        );
      }

      const results = await Promise.all(fileOperations);
      const successCount = results.filter(r => r.success).length;
      const operationTime = Date.now() - startTime;

      // Performance assertions
      expect(successCount).toBeGreaterThanOrEqual(45); // At least 90% success rate
      expect(operationTime).toBeLessThan(10000); // Complete within 10 seconds

      // Verify system metrics
      const performanceMetrics = fileSystem.getPerformanceMetrics();
      expect(performanceMetrics.writeLatency.length).toBeGreaterThan(0);
      
      const avgWriteLatency = performanceMetrics.writeLatency.reduce((a, b) => a + b, 0) / performanceMetrics.writeLatency.length;
      expect(avgWriteLatency).toBeLessThan(200); // Average < 200ms per operation

      // Verify caching effectiveness
      const cacheStats = fileSystem.getCacheStats();
      expect(cacheStats.hitRate).toBeGreaterThan(0);
    });

    it('should handle storage optimization under pressure', async () => {
      // Fill system with files to trigger optimization
      const fileIds = [];
      
      for (let i = 0; i < 30; i++) {
        const content = Buffer.alloc(1000, `content-${i}`);
        const result = await fileSystem.writeFile(adminToken, `bulk-${i}.txt`, content, 'admin');
        if (result.success) {
          fileIds.push(result.data!);
        }
      }

      // Delete some files to create fragmentation
      for (let i = 0; i < 15; i++) {
        await fileSystem.deleteFile(adminToken, fileIds[i]);
      }

      // Trigger optimization processes
      const defragResult = await fileSystem.performDefragmentation(adminToken);
      expect(defragResult.success).toBe(true);

      const tieringResult = await fileSystem.performDataTiering(adminToken);
      expect(tieringResult.success).toBe(true);

      // Verify system is still responsive
      const testContent = Buffer.from('Post-optimization test');
      const testResult = await fileSystem.writeFile(adminToken, 'post-optim.txt', testContent, 'admin');
      expect(testResult.success).toBe(true);

      const readResult = await fileSystem.readFile(adminToken, testResult.data!);
      expect(readResult.success).toBe(true);
      expect(Buffer.compare(readResult.data!, testContent)).toBe(0);
    });
  });

  describe('Compliance & Audit Workflow', () => {
    it('should generate comprehensive audit trails for compliance', async () => {
      // 1. Perform various operations that should be audited
      const sensitiveDoc = Buffer.from('Confidential employee salary information');
      
      const writeResult = await fileSystem.writeFile(managerToken, 'salaries.xlsx', sensitiveDoc, 'manager');
      expect(writeResult.success).toBe(true);

      // Multiple access attempts from different users
      await fileSystem.readFile(employeeToken, writeResult.data!);
      await fileSystem.readFile(managerToken, writeResult.data!);
      await fileSystem.readFile(adminToken, writeResult.data!);

      // Failed authentication attempts (security events)
      await fileSystem.authenticateUser({ username: 'manager', password: 'wrong' });
      await fileSystem.authenticateUser({ username: 'employee', password: 'wrong' });

      // 2. Generate audit report
      const securityEvents = fileSystem.getSecurityEvents(100);
      const auditReport = {
        fileOperations: securityEvents.filter(e => e.resource === 'files'),
        authEvents: securityEvents.filter(e => e.action.includes('AUTH')),
        successfulOps: securityEvents.filter(e => e.result === 'SUCCESS'),
        failedOps: securityEvents.filter(e => e.result === 'FAILURE'),
        timeRange: {
          start: securityEvents[securityEvents.length - 1]?.timestamp,
          end: securityEvents[0]?.timestamp
        }
      };

      // 3. Verify audit completeness
      expect(auditReport.fileOperations.length).toBeGreaterThan(0);
      expect(auditReport.authEvents.length).toBeGreaterThan(0);
      expect(auditReport.failedOps.length).toBeGreaterThan(0);

      // 4. Check data retention compliance
      const allFiles = await fileSystem.searchFiles(adminToken, {});
      expect(allFiles.success).toBe(true);
      
      // All files should have required metadata for compliance
      const filesWithCompleteMetadata = allFiles.data!.filter(file => 
        file.owner && file.createdAt && file.lastAccessed
      );
      expect(filesWithCompleteMetadata.length).toBe(allFiles.data!.length);

      console.log('Audit Report Summary:', {
        totalEvents: securityEvents.length,
        fileOperations: auditReport.fileOperations.length,
        authEvents: auditReport.authEvents.length,
        successfulOps: auditReport.successfulOps.length,
        failedOps: auditReport.failedOps.length,
        filesTracked: allFiles.data!.length
      });
    });

    it('should handle data export for regulatory compliance', async () => {
      // Create user data that might need to be exported for GDPR/data portability
      const userData = [
        { type: 'personal', content: Buffer.from('User personal information') },
        { type: 'medical', content: Buffer.from('User medical records') },
        { type: 'financial', content: Buffer.from('User financial data') }
      ];

      const userFileIds = [];
      
      for (const data of userData) {
        const result = await fileSystem.writeFile(
          employeeToken, 
          `employee-${data.type}.json`, 
          data.content, 
          'employee'
        );
        expect(result.success).toBe(true);
        userFileIds.push(result.data!);
      }

      // Export all data for specific user (data portability requirement)
      const userFiles = await fileSystem.searchFiles(adminToken, {
        owner: 'employee'
      });
      
      expect(userFiles.success).toBe(true);
      expect(userFiles.data!.length).toBe(3);

      // Verify each file can be retrieved for export
      const exportData = [];
      for (const file of userFiles.data!) {
        const content = await fileSystem.readFile(adminToken, file.id);
        if (content.success) {
          exportData.push({
            filename: file.name,
            size: file.size,
            created: file.createdAt,
            content: content.data!.toString()
          });
        }
      }

      expect(exportData.length).toBe(3);
      
      // Simulate data export process
      const exportPackage = {
        userId: 'employee',
        exportDate: new Date(),
        files: exportData,
        metadata: {
          totalSize: exportData.reduce((sum, file) => sum + file.size, 0),
          fileTypes: exportData.map(f => f.filename.split('.').pop()),
          integrityCheck: true
        }
      };

      expect(exportPackage.files.length).toBe(3);
      expect(exportPackage.metadata.totalSize).toBeGreaterThan(0);
    });
  });

  describe('System Recovery & Business Continuity', () => {
    it('should maintain business operations during partial system failures', async () => {
      // 1. Establish baseline operations
      const baselineDoc = Buffer.from('Business continuity test document');
      const baselineResult = await fileSystem.writeFile(managerToken, 'baseline.txt', baselineDoc, 'manager');
      expect(baselineResult.success).toBe(true);

      // 2. Simulate partial system degradation (corrupt some storage)
      const partialCorruption = Buffer.alloc(1000, 0xFF);
      await disk.write(500, partialCorruption);

      // 3. System should continue accepting new operations
      const duringFailureDoc = Buffer.from('Document created during system stress');
      const duringFailureResult = await fileSystem.writeFile(
        adminToken, 
        'during-failure.txt', 
        duringFailureDoc, 
        'admin'
      );
      expect(duringFailureResult.success).toBe(true);

      // 4. Existing data should remain accessible (with recovery if needed)
      const recoveredBaseline = await fileSystem.readFile(managerToken, baselineResult.data!, {
        allowPartialRecovery: true,
        minimumRecoveryRate: 50
      });
      
      // Should succeed either through normal read or partial recovery
      expect(recoveredBaseline.success).toBe(true);

      // 5. New data should be fully accessible
      const newDataRead = await fileSystem.readFile(adminToken, duringFailureResult.data!);
      expect(newDataRead.success).toBe(true);
      expect(Buffer.compare(newDataRead.data!, duringFailureDoc)).toBe(0);

      // 6. Verify system health reporting during degradation
      const healthReport = fileSystem.getSystemHealthReport();
      expect(healthReport.corruption.healthScore).toBeGreaterThan(50); // Still operational
      
      console.log('Business Continuity Test Results:', {
        healthScore: healthReport.corruption.healthScore,
        newOperationsSuccessful: duringFailureResult.success,
        dataRecoverySuccessful: recoveredBaseline.success,
        systemStillOperational: true
      });
    });
  });
});

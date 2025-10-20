const mongoose = require('mongoose');

const walletTransactionSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['credit', 'debit', 'refund', 'hold', 'release', 'capture', 'transfer_in', 'transfer_out'],
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  description: {
    type: String,
    required: true
  },
  bookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking'
  },
  referenceId: {
    type: String,
    required: true,
    validate: {
      validator: function(v) {
        return v && v !== null && v !== 'null' && v !== '';
      },
      message: 'ReferenceId must be a valid non-null string'
    }
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'cancelled'],
    default: 'pending'
  },
  holdReference: {
    type: String,
    sparse: true // Only for hold-related transactions
  },
  relatedTransactionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WalletTransaction'
  },
  paymentMethod: {
    type: String,
    enum: ['gcash', 'paymaya', 'card', 'wallet_transfer', 'receipt_approval'],
    required: function() {
      return this.type === 'credit';
    }
  },
  metadata: {
    type: Map,
    of: String
  }
}, {
  timestamps: true
});

// Utility function to generate unique reference ID
const generateReferenceId = () => {
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substr(2, 9).toUpperCase();
  const counter = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `TXN-${timestamp}-${randomStr}-${counter}`;
};

const walletSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  availableBalance: {
    type: Number,
    default: 0,
    min: 0
  },
  transactions: [walletTransactionSchema],
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Pre-save hook to ensure referenceIds
walletSchema.pre('save', function(next) {
  // Ensure all transactions have valid referenceIds
  this.transactions.forEach(transaction => {
    if (!transaction.referenceId || transaction.referenceId === null || transaction.referenceId === 'null') {
      transaction.referenceId = generateReferenceId();
    }
  });
  
  next();
});

// Indexes
// walletSchema.index({ userId: 1 }, { unique: true }); // Removed - already unique in schema
// Simple referenceId index without compound uniqueness (handled by pre-save hook)
walletSchema.index({ 'transactions.referenceId': 1 });
// walletSchema.index({ 'transactions.holdReference': 1 }); // Removed - already sparse in schema

// Methods
walletSchema.methods.addTransaction = async function(transactionData) {
  // Ensure referenceId is generated if not provided or is null/undefined
  if (!transactionData.referenceId || transactionData.referenceId === null || transactionData.referenceId === 'null') {
    transactionData.referenceId = generateReferenceId();
  }
  
  // Retry logic for duplicate referenceId
  let retries = 3;
  while (retries > 0) {
    try {
      // Ensure referenceId is valid before pushing
      if (!transactionData.referenceId || transactionData.referenceId === 'null') {
        transactionData.referenceId = generateReferenceId();
      }
      
      this.transactions.push(transactionData);
      return await this.save();
    } catch (error) {
      if (error.code === 11000 && error.message.includes('referenceId')) {
        // Duplicate key error, generate new referenceId and retry
        transactionData.referenceId = generateReferenceId();
        this.transactions.pop(); // Remove the failed transaction
        retries--;
        if (retries === 0) {
          throw new Error('Failed to generate unique referenceId after multiple attempts');
        }
      } else {
        throw error;
      }
    }
  }
};

walletSchema.methods.updateBalance = function(amount, type) {
  if (type === 'credit' || type === 'refund') {
    this.availableBalance += amount;
  } else if (type === 'debit') {
    if (this.availableBalance < amount) {
      throw new Error('Insufficient balance');
    }
    this.availableBalance -= amount;
  }
  return this.save();
};

walletSchema.methods.hasSufficientBalance = function(amount) {
  return this.availableBalance >= amount;
};

// Get current available balance (now just returns the single balance field)
walletSchema.methods.getAvailableBalance = function() {
  return this.availableBalance;
};

// Hold amount for booking reservation (deducts from availableBalance immediately)
walletSchema.methods.holdAmount = function(amount, bookingId, description) {
  if (this.availableBalance < amount) {
    throw new Error('Insufficient available balance for hold');
  }
  
  const holdReference = `HOLD-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
  
  const holdTransaction = {
    type: 'hold',
    amount: amount,
    description: description || `Hold for booking ${bookingId}`,
    bookingId: bookingId,
    status: 'completed',
    holdReference: holdReference,
    referenceId: generateReferenceId()
  };
  
  // Immediately deduct from available balance when holding
  this.availableBalance -= amount;
  this.transactions.push(holdTransaction);
  
  return this.save().then(() => holdReference);
};

// Release held amount (refund) - adds money back to availableBalance
walletSchema.methods.releaseHold = function(holdReference, reason) {
  const holdTransaction = this.transactions.find(
    t => t.holdReference === holdReference && t.type === 'hold' && t.status === 'completed'
  );
  
  if (!holdTransaction) {
    throw new Error('Hold transaction not found');
  }
  
  const releaseTransaction = {
    type: 'release',
    amount: holdTransaction.amount,
    description: reason || `Release hold ${holdReference}`,
    referenceId: generateReferenceId(),
    bookingId: holdTransaction.bookingId,
    status: 'completed',
    holdReference: holdReference,
    relatedTransactionId: holdTransaction._id
  };
  
  // Add money back to available balance when releasing hold
  this.availableBalance += holdTransaction.amount;
  this.transactions.push(releaseTransaction);
  
  return this.save();
};

// Capture held amount (convert to payment) - money already deducted, just record the transaction
walletSchema.methods.captureHold = function(holdReference, description) {
  const holdTransaction = this.transactions.find(
    t => t.holdReference === holdReference && t.type === 'hold' && t.status === 'completed'
  );
  
  if (!holdTransaction) {
    throw new Error('Hold transaction not found');
  }
  
  const captureTransaction = {
    type: 'capture',
    amount: holdTransaction.amount,
    description: description || `Capture hold ${holdReference}`,
    referenceId: generateReferenceId(),
    bookingId: holdTransaction.bookingId,
    status: 'completed',
    holdReference: holdReference,
    relatedTransactionId: holdTransaction._id
  };
  
  // Money was already deducted during hold, just record the capture
  this.transactions.push(captureTransaction);
  
  return this.save();
};

// Static methods
walletSchema.statics.findByUserId = function(userId) {
  return this.findOne({ userId, isActive: true });
};

walletSchema.statics.createWallet = function(userId, initialBalance = 0) {
  return this.create({
    userId,
    availableBalance: initialBalance,
    transactions: [],
    isActive: true
  });
};

const Wallet = mongoose.model('Wallet', walletSchema);
const WalletTransaction = mongoose.model('WalletTransaction', walletTransactionSchema);

module.exports = { Wallet, WalletTransaction };
